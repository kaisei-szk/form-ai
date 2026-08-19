import getSql from './db'
import type { QueueJob, ExecuteParams } from './types'
import { updateRunStatus, expireStaleRuns, getProjectRun } from './project-manager'

export const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_RUNS || '3', 10)

let _startupRecoveryDone = false

function rowToJob(r: Record<string, unknown>): QueueJob {
  return {
    id:          r.id as string,
    runId:       r.run_id as string,
    projectId:   r.project_id as string,
    status:      r.status as QueueJob['status'],
    params:      r.params as ExecuteParams,
    createdAt:   r.created_at as string,
    startedAt:   r.started_at as string | undefined,
    completedAt: r.completed_at as string | undefined,
    error:       r.error as string | undefined,
  }
}

async function recoverStaleActiveJobs(): Promise<void> {
  if (_startupRecoveryDone) return
  _startupRecoveryDone = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data: staleRows, error } = await supabase.from('queue_jobs').select('*').eq('status', 'active')
  if (error) throw error
  for (const row of staleRows ?? []) {
    const job = rowToJob(row)
    const existingRun = await getProjectRun(job.runId)
    if (existingRun?.status === 'success') {
      const { error: updateError } = await supabase
        .from('queue_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', job.id)
      if (updateError) throw updateError
    } else {
      const { error: updateError } = await supabase
        .from('queue_jobs')
        .update({ status: 'failed', completed_at: new Date().toISOString(), error: 'server_restart' })
        .eq('id', job.id)
      if (updateError) throw updateError
      if (existingRun && existingRun.status !== 'error') {
        await updateRunStatus(job.runId, 'error', existingRun.n8nExecutionId, existingRun.itemsWritten, {
          completedAt: new Date().toISOString(),
          error: 'Webサーバー再起動のため実行状態を復旧できませんでした',
        })
      }
    }
  }
}

export async function enqueue(runId: string, projectId: string, params: ExecuteParams): Promise<{
  job: QueueJob
  canStart: boolean
  queuePosition: number
}> {
  await recoverStaleActiveJobs()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const createdAt = new Date().toISOString()

  const { count: activeCount, error: activeError } = await supabase
    .from('queue_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
  if (activeError) throw activeError
  const canStart = (activeCount ?? 0) < MAX_CONCURRENT

  const { error: insertError } = await supabase.from('queue_jobs').insert({
    id,
    run_id: runId,
    project_id: projectId,
    status: canStart ? 'active' : 'waiting',
    params,
    created_at: createdAt,
  })
  if (insertError) throw insertError

  const { count: waitingCount, error: waitingError } = await supabase
    .from('queue_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'waiting')
  if (waitingError) throw waitingError

  return {
    job: { id, runId, projectId, status: canStart ? 'active' : 'waiting', params, createdAt },
    canStart,
    queuePosition: canStart ? 0 : (waitingCount ?? 0),
  }
}

export async function markJobActive(runId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { error } = await supabase
    .from('queue_jobs')
    .update({ status: 'active', started_at: new Date().toISOString() })
    .eq('run_id', runId)
    .in('status', ['waiting', 'active'])
  if (error) throw error
}

export async function markJobDone(runId: string, status: 'completed' | 'failed', error?: string): Promise<QueueJob | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data: updatedRows, error: updateError } = await supabase
    .from('queue_jobs')
    .update({ status, completed_at: new Date().toISOString(), error: error ?? null })
    .eq('run_id', runId)
    .eq('status', 'active')
    .select('id')
  if (updateError) throw updateError
  if (!updatedRows || updatedRows.length === 0) return undefined

  const { count: activeCount, error: activeError } = await supabase
    .from('queue_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
  if (activeError) throw activeError
  if ((activeCount ?? 0) >= MAX_CONCURRENT) return undefined

  const { data: nextRows, error: nextError } = await supabase
    .from('queue_jobs')
    .select('*')
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
    .limit(1)
  if (nextError) throw nextError
  if (!nextRows || nextRows.length === 0) return undefined
  const next = rowToJob(nextRows[0])
  const { error: activateError } = await supabase
    .from('queue_jobs')
    .update({ status: 'active', started_at: new Date().toISOString() })
    .eq('id', next.id)
  if (activateError) throw activateError
  return { ...next, status: 'active' }
}

export async function getQueueStatus(): Promise<{
  active: number
  waiting: number
  maxConcurrent: number
  recentJobs: QueueJob[]
}> {
  await expireStaleRuns()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any

  // Auto-recover stale active jobs (> 2h)
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: staleActive, error: staleError } = await supabase
    .from('queue_jobs')
    .select('id, started_at, created_at')
    .eq('status', 'active')
  if (staleError) throw staleError
  const staleIds = (staleActive ?? [])
    .filter((r: Record<string, unknown>) => ((r.started_at as string) ?? (r.created_at as string)) < cutoff)
    .map((r: Record<string, unknown>) => r.id as string)

  if (staleIds.length > 0) {
    const { error: recoverError } = await supabase
      .from('queue_jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error: 'auto_expired_stale_active' })
      .in('id', staleIds)
    if (recoverError) throw recoverError

    const base = process.env.INTERNAL_BASE_URL || 'http://localhost:3000'
    const { count: activeAfter, error: activeAfterError } = await supabase
      .from('queue_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
    if (activeAfterError) throw activeAfterError
    const slots = MAX_CONCURRENT - (activeAfter ?? 0)
    if (slots > 0) {
      const { data: waiting, error: waitingError } = await supabase
        .from('queue_jobs')
        .select('*')
        .eq('status', 'waiting')
        .order('created_at', { ascending: true })
        .limit(slots)
      if (waitingError) throw waitingError
      for (const row of waiting ?? []) {
        const job = rowToJob(row)
        fetch(`${base}/api/queue/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: job.runId, params: job.params }),
        }).catch(() => {})
      }
    }
  }

  const [activeResult, waitingResult, recentResult] = await Promise.all([
    supabase.from('queue_jobs').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('queue_jobs').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
    supabase.from('queue_jobs').select('*').order('created_at', { ascending: false }).limit(50),
  ])
  if (activeResult.error) throw activeResult.error
  if (waitingResult.error) throw waitingResult.error
  if (recentResult.error) throw recentResult.error

  return {
    active:        activeResult.count  ?? 0,
    waiting:       waitingResult.count ?? 0,
    maxConcurrent: MAX_CONCURRENT,
    recentJobs:    (recentResult.data ?? []).map(rowToJob),
  }
}

export async function getQueuePosition(runId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('run_id')
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
  if (error) throw error
  const index = (data ?? []).findIndex((r: Record<string, unknown>) => r.run_id === runId)
  return index >= 0 ? index + 1 : 0
}

export async function isQueueIdle(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { count, error } = await supabase
    .from('queue_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['active', 'waiting'])
  if (error) throw error
  return (count ?? 0) === 0
}

export async function pruneOldJobs(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('id, completed_at, created_at')
    .in('status', ['completed', 'failed'])
  if (error) throw error

  const sorted = (data ?? []).slice().sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aDate = (a.completed_at as string) ?? (a.created_at as string)
    const bDate = (b.completed_at as string) ?? (b.created_at as string)
    return bDate.localeCompare(aDate)
  })
  const idsToDelete = sorted.slice(200).map((r: Record<string, unknown>) => r.id as string)
  if (idsToDelete.length === 0) return

  const { error: deleteError } = await supabase.from('queue_jobs').delete().in('id', idsToDelete)
  if (deleteError) throw deleteError
}

export async function getJobByRunId(runId: string): Promise<QueueJob | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data && data.length > 0 ? rowToJob(data[0]) : undefined
}
