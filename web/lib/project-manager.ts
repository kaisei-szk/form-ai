import getSql from './db'
import type { Project, ProjectRun, SearchTarget } from './types'
import type { SerperSearchCheckpoint, SerperSearchProgress } from './serper'

// ── helper: DB row → typed objects ────────────────────────────────

function rowToProject(r: Record<string, unknown>): Project {
  return {
    id:          r.id as string,
    name:        r.name as string,
    description: r.description as string | undefined,
    createdAt:   r.created_at as string,
    runIds:      (r.run_ids as string[]) ?? [],
    sheetsId:    r.sheets_id as string | undefined,
  }
}

function rowToRun(r: Record<string, unknown>): ProjectRun {
  const storedResults = r.results as (ProjectRun['results'] & { searchCheckpoint?: unknown }) | undefined
  const publicResults = storedResults ? { ...storedResults } : undefined
  if (publicResults && 'searchCheckpoint' in publicResults) delete publicResults.searchCheckpoint
  return {
    id:              r.id as string,
    projectId:       r.project_id as string,
    label:           r.label as string,
    createdAt:       r.created_at as string,
    searchTarget:    (r.search_target as SearchTarget) ?? {},
    status:          r.status as ProjectRun['status'],
    runType:         r.run_type as ProjectRun['runType'] | undefined,
    parentRunId:     r.parent_run_id as string | undefined,
    childRunIds:     r.child_run_ids as string[] | undefined,
    n8nExecutionId:  r.n8n_execution_id as string | undefined,
    itemsWritten:    r.items_written as number | undefined,
    completedAt:     r.completed_at as string | undefined,
    estimatedCostUsd: r.estimated_cost_usd as number | undefined,
    tokensInput:     r.tokens_input as number | undefined,
    tokensOutput:    r.tokens_output as number | undefined,
    rawSearchCount:  r.raw_search_count as number | undefined,
    results:         publicResults,
    error:           r.error as string | undefined,
  }
}

export async function getRunSearchCheckpoint(runId: string): Promise<SerperSearchCheckpoint | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase.from('project_runs').select('results').eq('id', runId).limit(1)
  if (error) throw error
  return data?.[0]?.results?.searchCheckpoint as SerperSearchCheckpoint | undefined
}

export async function updateRunSearchProgress(
  runId: string,
  progress: SerperSearchProgress & { resumedFromRunId?: string },
  checkpoint?: SerperSearchCheckpoint,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error: readError } = await supabase
    .from('project_runs')
    .select('status, error, results')
    .eq('id', runId)
    .limit(1)
  if (readError) throw readError
  const row = data?.[0]
  if (!row || (row.status === 'error' && String(row.error ?? '').includes('キャンセル'))) return
  const existingResults = row.results && typeof row.results === 'object' ? row.results : {}
  const results = {
    ...existingResults,
    searchProgress: progress,
    ...(checkpoint ? { searchCheckpoint: checkpoint } : {}),
  }
  const { error } = await supabase
    .from('project_runs')
    .update({ raw_search_count: progress.candidateCount, results })
    .eq('id', runId)
  if (error) throw error
}

// ─── Projects ──────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToProject)
}

export async function getProject(id: string): Promise<Project | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).limit(1)
  if (error) throw error
  return data && data.length > 0 ? rowToProject(data[0]) : undefined
}

export async function createProject(name: string, description?: string): Promise<Project> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const { data: existing, error: countError } = await supabase
    .from('projects')
    .select('id')
    .like('id', `proj-${today}%`)
  if (countError) throw countError
  const seq = String((existing?.length ?? 0) + 1).padStart(3, '0')
  const project: Project = {
    id:          `proj-${today}-${seq}`,
    name,
    description,
    createdAt:   new Date().toISOString(),
    runIds:      [],
  }
  const { error } = await supabase.from('projects').insert({
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    created_at: project.createdAt,
    run_ids: [],
  })
  if (error) throw error
  return project
}

export async function linkSheets(projectId: string, sheetsId: string): Promise<Project> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { error } = await supabase.from('projects').update({ sheets_id: sheetsId }).eq('id', projectId)
  if (error) throw error
  const p = await getProject(projectId)
  if (!p) throw new Error(`Project ${projectId} not found`)
  return p
}

export async function deleteProject(id: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}

export async function deleteRun(runId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const run = await getProjectRun(runId)
  if (!run) return null

  const { error: deleteError } = await supabase.from('project_runs').delete().eq('id', runId)
  if (deleteError) throw deleteError

  const project = await getProject(run.projectId)
  if (project) {
    const newRunIds = project.runIds.filter((id) => id !== runId)
    const { error: updateError } = await supabase
      .from('projects')
      .update({ run_ids: newRunIds })
      .eq('id', run.projectId)
    if (updateError) throw updateError
  }
  return runId
}

// ─── Runs ──────────────────────────────────────────────────────────

export async function getRunsForProject(projectId: string): Promise<ProjectRun[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase
    .from('project_runs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToRun)
}

/** Fetch every project run in one query for list/history pages. */
export async function getAllProjectRuns(): Promise<ProjectRun[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase
    .from('project_runs')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToRun)
}

export async function getProjectRun(runId: string): Promise<ProjectRun | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase.from('project_runs').select('*').eq('id', runId).limit(1)
  if (error) throw error
  return data && data.length > 0 ? rowToRun(data[0]) : undefined
}

async function appendRunId(projectId: string, runId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const project = await getProject(projectId)
  if (!project) return
  if (project.runIds.includes(runId)) return
  const { error } = await supabase
    .from('projects')
    .update({ run_ids: [...project.runIds, runId] })
    .eq('id', projectId)
  if (error) throw error
}

export async function addRunToProject(
  projectId: string,
  run: { id: string; label: string; searchTarget: SearchTarget }
): Promise<ProjectRun> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const projectRun: ProjectRun = {
    id:           run.id,
    projectId,
    label:        run.label,
    createdAt:    new Date().toISOString(),
    searchTarget: run.searchTarget,
    status:       'pending',
  }
  const { error } = await supabase.from('project_runs').insert({
    id: projectRun.id,
    project_id: projectId,
    label: projectRun.label,
    created_at: projectRun.createdAt,
    search_target: run.searchTarget,
    status: 'pending',
  })
  if (error) throw error
  await appendRunId(projectId, run.id)
  return projectRun
}

export async function addBatchRunToProject(
  projectId: string,
  parent: { id: string; label: string; searchTarget: SearchTarget },
  children: { id: string; area: string; label: string }[],
): Promise<{ parent: ProjectRun; children: ProjectRun[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any

  const childRuns: ProjectRun[] = children.map((c) => ({
    id:           c.id,
    projectId,
    label:        c.label,
    createdAt:    new Date().toISOString(),
    searchTarget: { ...parent.searchTarget, area: c.area, areas: undefined },
    status:       'pending' as const,
    runType:      'child' as const,
    parentRunId:  parent.id,
  }))

  const parentRun: ProjectRun = {
    id:           parent.id,
    projectId,
    label:        parent.label,
    createdAt:    new Date().toISOString(),
    searchTarget: parent.searchTarget,
    status:       'pending',
    runType:      'batch',
    childRunIds:  children.map((c) => c.id),
  }

  const { error: parentError } = await supabase.from('project_runs').insert({
    id: parentRun.id,
    project_id: projectId,
    label: parentRun.label,
    created_at: parentRun.createdAt,
    search_target: parent.searchTarget,
    status: 'pending',
    run_type: 'batch',
    child_run_ids: children.map((c) => c.id),
  })
  if (parentError) throw parentError

  const { error: childrenError } = await supabase.from('project_runs').insert(
    childRuns.map((c) => ({
      id: c.id,
      project_id: projectId,
      label: c.label,
      created_at: c.createdAt,
      search_target: c.searchTarget,
      status: 'pending',
      run_type: 'child',
      parent_run_id: parent.id,
    }))
  )
  if (childrenError) throw childrenError

  await appendRunId(projectId, parent.id)
  return { parent: parentRun, children: childRuns }
}

export async function rollupBatchRun(parentRunId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const parent = await getProjectRun(parentRunId)
  if (!parent) return
  if (!parent.childRunIds?.length) return

  const { data: childRows, error: childError } = await supabase
    .from('project_runs')
    .select('*')
    .in('id', parent.childRunIds)
  if (childError) throw childError
  const children: ProjectRun[] = (childRows ?? []).map(rowToRun)

  const allTerminal = children.every((c: ProjectRun) => c.status === 'success' || c.status === 'completed' || c.status === 'error')
  if (!allTerminal) return

  const currentSum = children.reduce((s: number, c: ProjectRun) => s + (c.itemsWritten ?? 0), 0)
  if ((parent.status === 'success' || parent.status === 'completed') && parent.itemsWritten === currentSum && parent.completedAt) return

  const totalItems     = children.reduce((s: number, c: ProjectRun) => s + (c.itemsWritten        ?? 0), 0)
  const totalCost      = children.reduce((s: number, c: ProjectRun) => s + (c.estimatedCostUsd    ?? 0), 0)
  const totalTokIn     = children.reduce((s: number, c: ProjectRun) => s + (c.tokensInput         ?? 0), 0)
  const totalTokOut    = children.reduce((s: number, c: ProjectRun) => s + (c.tokensOutput         ?? 0), 0)
  const totalRawSearch = children.reduce((s: number, c: ProjectRun) => s + (c.rawSearchCount      ?? 0), 0)
  const allSucceeded   = children.every((c: ProjectRun) => c.status === 'success' || c.status === 'completed')
  const failedChildren = children.filter((c: ProjectRun) => c.status === 'error')
  const numericResultKeys: Array<keyof import('./types').BenchmarkResults> = [
    'totalCompanies', 'afterDedup', 'successCount', 'errorCount', 'formFoundCount',
    'itemsWritten', 'elapsedMs', 'queryCount', 'relevanceRejectedCount',
    'searchFailedQueries', 'areaRejectedCount', 'blockedDomainCount',
    'duplicateCandidateCount', 'rawCandidateCount', 'uniquePlaceCount',
    'noWebsiteCount', 'paginationRepeatCount', 'exhaustedQueryCount',
    'pageCapReachedQueryCount', 'hpFetchFailureCount',
    'placesCandidateCount', 'organicCandidateCount', 'organicRawCandidateCount',
    'organicRejectedCount', 'organicQueriesExecuted', 'organicFailedQueries',
    'organicExhaustedQueryCount', 'organicPageCapReachedQueryCount',
    'searchElapsedMs', 'hpNotFoundCount', 'hpNotFoundSaved',
    'retryLoadedCount', 'retryResolvedCount', 'retryRemainingCount',
    'holdRetryLoadedCount', 'pendingRetryLoadedCount',
  ]
  const rolledResults: import('./types').BenchmarkResults = {
    totalCompanies: 0,
    afterDedup: 0,
    successCount: 0,
    errorCount: 0,
    formFoundCount: 0,
    formFoundRate: 0,
    itemsWritten: totalItems,
    elapsedMs: 0,
    avgMsPerItem: 0,
  }
  for (const key of numericResultKeys) {
    const total = children.reduce((sum: number, child: ProjectRun) => {
      const value = child.results?.[key]
      return sum + (typeof value === 'number' ? value : 0)
    }, 0)
    // Every key in numericResultKeys is numeric by construction.
    ;(rolledResults as unknown as Record<string, number>)[key] = total
  }
  rolledResults.formFoundRate = Math.round(
    ((rolledResults.formFoundCount ?? 0) / Math.max(rolledResults.afterDedup ?? 0, 1)) * 100,
  )
  rolledResults.avgMsPerItem = Math.round(
    (rolledResults.elapsedMs ?? 0) / Math.max(rolledResults.afterDedup ?? 0, 1),
  )
  rolledResults.maxPages = children.reduce((max: number, child: ProjectRun) => Math.max(max, child.results?.maxPages ?? 0), 0) || undefined
  rolledResults.organicMaxPages = children.reduce(
    (max: number, child: ProjectRun) => Math.max(max, child.results?.organicMaxPages ?? 0),
    0,
  ) || undefined
  rolledResults.searchTimeBudgetReached = children.some(
    (child) => child.results?.searchTimeBudgetReached === true,
  )
  rolledResults.relevanceReasonCounts = children.reduce<Record<string, number>>((totals, child) => {
    for (const [reason, count] of Object.entries(child.results?.relevanceReasonCounts ?? {})) {
      totals[reason] = (totals[reason] ?? 0) + count
    }
    return totals
  }, {})
  rolledResults.warnings = [...new Set(children.flatMap((child) => child.results?.warnings ?? []))].slice(0, 100)

  const childErrorDetails = failedChildren
    .map((child) => `${child.searchTarget.area}: ${child.error || '不明なエラー'}`)
    .slice(0, 10)

  const { error } = await supabase
    .from('project_runs')
    .update({
      status:             allSucceeded ? 'success' : 'error',
      items_written:      totalItems,
      completed_at:       new Date().toISOString(),
      estimated_cost_usd: totalCost > 0 ? totalCost : null,
      tokens_input:       totalTokIn > 0 ? totalTokIn : null,
      tokens_output:      totalTokOut > 0 ? totalTokOut : null,
      raw_search_count:   totalRawSearch > 0 ? totalRawSearch : null,
      results:            rolledResults,
      error:              allSucceeded
        ? null
        : `${failedChildren.length}/${children.length}件のエリアで実行に失敗しました: ${childErrorDetails.join(' / ')}`,
    })
    .eq('id', parentRunId)
  if (error) throw error
}

export async function getChildRuns(parentRunId: string): Promise<ProjectRun[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase.from('project_runs').select('*').eq('parent_run_id', parentRunId)
  if (error) throw error
  return (data ?? []).map(rowToRun)
}

export interface RunStatusUpdate {
  tokensInput?: number
  tokensOutput?: number
  estimatedCostUsd?: number
  completedAt?: string
  rawSearchCount?: number
  results?: import('./types').BenchmarkResults
  searchCheckpoint?: SerperSearchCheckpoint
  error?: string
}

export async function expireStaleRuns(
  runningMaxAgeMs = 2 * 60 * 60 * 1000,
  pendingMaxAgeMs = 24 * 60 * 60 * 1000,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const now = new Date()
  const runningCutoff = new Date(now.getTime() - runningMaxAgeMs).toISOString()
  const pendingCutoff  = new Date(now.getTime() - pendingMaxAgeMs).toISOString()

  const { data: runningRows, error: runningError } = await supabase
    .from('project_runs')
    .update({
      status: 'error',
      completed_at: now.toISOString(),
      error: '実行開始から2時間以上応答がないためタイムアウトしました',
    })
    .eq('status', 'running')
    .lt('created_at', runningCutoff)
    .select('id')
  if (runningError) throw runningError

  const { data: pendingRows, error: pendingError } = await supabase
    .from('project_runs')
    .update({
      status: 'error',
      completed_at: now.toISOString(),
      error: 'キュー待機が24時間を超えたためタイムアウトしました',
    })
    .eq('status', 'pending')
    .lt('created_at', pendingCutoff)
    .select('id')
  if (pendingError) throw pendingError

  return (runningRows?.length ?? 0) + (pendingRows?.length ?? 0)
}

export async function updateRunStatus(
  runId: string,
  status: ProjectRun['status'],
  n8nExecutionId?: string,
  itemsWritten?: number,
  extra?: RunStatusUpdate
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: Record<string, any> = { status }
  if (n8nExecutionId          !== undefined) fields.n8n_execution_id    = n8nExecutionId
  if (itemsWritten            !== undefined) fields.items_written       = itemsWritten
  if (extra?.tokensInput      !== undefined) fields.tokens_input        = extra.tokensInput
  if (extra?.tokensOutput     !== undefined) fields.tokens_output       = extra.tokensOutput
  if (extra?.estimatedCostUsd !== undefined) fields.estimated_cost_usd  = extra.estimatedCostUsd
  if (extra?.completedAt      !== undefined) fields.completed_at        = extra.completedAt
  if (extra?.rawSearchCount   !== undefined) fields.raw_search_count    = extra.rawSearchCount
  if (extra?.results          !== undefined) fields.results             = extra.searchCheckpoint
    ? { ...extra.results, searchCheckpoint: extra.searchCheckpoint }
    : extra.results
  if (extra?.error            !== undefined) fields.error               = extra.error

  const { error } = await supabase.from('project_runs').update(fields).eq('id', runId)
  if (error) throw error
}
