import getSql from './db'
import type { QueueJob, ExecuteParams } from './types'
import { updateRunStatus, expireStaleRuns } from './project-manager'
import { getInternalJsonHeaders } from './internal-auth'

const configuredMaxConcurrent = Number.parseInt(process.env.MAX_CONCURRENT_RUNS || '3', 10)
export const MAX_CONCURRENT = Number.isFinite(configuredMaxConcurrent)
  ? Math.min(20, Math.max(1, configuredMaxConcurrent))
  : 3

const SLOT_PREFIX = 'queue-slot-lease-'

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505'
}

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

async function acquireQueueSlot(job: QueueJob): Promise<string | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  for (let slot = 1; slot <= MAX_CONCURRENT; slot++) {
    const slotId = `${SLOT_PREFIX}${slot}`
    const { error } = await supabase.from('queue_jobs').insert({
      id: slotId,
      run_id: `slot:${slot}:${job.runId}`,
      project_id: job.projectId,
      status: 'active',
      params: job.params,
      created_at: new Date().toISOString(),
      error: job.runId,
    })
    if (!error) return slotId
    if (!isUniqueViolation(error)) throw error
  }
  return undefined
}

async function releaseQueueSlotById(slotId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { error } = await supabase.from('queue_jobs').delete().eq('id', slotId)
  if (error) throw error
}

async function releaseQueueSlot(runId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { error } = await supabase
    .from('queue_jobs')
    .delete()
    .like('id', `${SLOT_PREFIX}%`)
    .eq('error', runId)
  if (error) throw error
}

async function tryActivateJob(job: QueueJob): Promise<boolean> {
  const slotId = await acquireQueueSlot(job)
  if (!slotId) return false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase
    .from('queue_jobs')
    .update({ status: 'active', started_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'waiting')
    .select('id')
  if (error) {
    await releaseQueueSlotById(slotId)
    throw error
  }
  if (!data || data.length === 0) {
    await releaseQueueSlotById(slotId)
    return false
  }
  return true
}

async function cleanupOrphanedSlots(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const [slotResult, activeResult] = await Promise.all([
    supabase.from('queue_jobs').select('id, error, created_at').like('id', `${SLOT_PREFIX}%`),
    supabase.from('queue_jobs').select('run_id').eq('status', 'active').not('id', 'like', `${SLOT_PREFIX}%`),
  ])
  if (slotResult.error) throw slotResult.error
  if (activeResult.error) throw activeResult.error

  const activeRunIds = new Set((activeResult.data ?? []).map((row: Record<string, unknown>) => row.run_id as string))
  const orphanCutoff = Date.now() - 60_000
  const orphanedIds = (slotResult.data ?? [])
    .filter((row: Record<string, unknown>) =>
      !activeRunIds.has(row.error as string)
      && new Date(row.created_at as string).getTime() < orphanCutoff
    )
    .map((row: Record<string, unknown>) => row.id as string)
  if (orphanedIds.length > 0) {
    const { error } = await supabase.from('queue_jobs').delete().in('id', orphanedIds)
    if (error) throw error
  }
}

export async function enqueue(runId: string, projectId: string, params: ExecuteParams): Promise<{
  job: QueueJob
  canStart: boolean
  queuePosition: number
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const createdAt = new Date().toISOString()

  const { error: insertError } = await supabase.from('queue_jobs').insert({
    id,
    run_id: runId,
    project_id: projectId,
    status: 'waiting',
    params,
    created_at: createdAt,
  })
  if (insertError) throw insertError

  const waitingJob: QueueJob = { id, runId, projectId, status: 'waiting', params, createdAt }
  const canStart = await tryActivateJob(waitingJob)

  const { count: waitingCount, error: waitingError } = await supabase
    .from('queue_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'waiting')
  if (waitingError) throw waitingError

  return {
    job: { ...waitingJob, status: canStart ? 'active' : 'waiting' },
    canStart,
    queuePosition: canStart ? 0 : (waitingCount ?? 0),
  }
}

export async function markJobActive(runId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('*')
    .eq('run_id', runId)
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`Queue job ${runId} not found`)
  const job = rowToJob(data[0])
  if (job.status === 'active') return
  if (job.status !== 'waiting' || !(await tryActivateJob(job))) {
    throw new Error(`No execution slot available for ${runId}`)
  }
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
  await releaseQueueSlot(runId)

  const { data: nextRows, error: nextError } = await supabase
    .from('queue_jobs')
    .select('*')
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
    .limit(MAX_CONCURRENT)
  if (nextError) throw nextError
  if (!nextRows || nextRows.length === 0) return undefined
  for (const row of nextRows) {
    const next = rowToJob(row)
    if (await tryActivateJob(next)) return { ...next, status: 'active' }
  }
  return undefined
}

export async function getQueueStatus(): Promise<{
  active: number
  waiting: number
  maxConcurrent: number
  recentJobs: QueueJob[]
}> {
  await expireStaleRuns()
  await cleanupOrphanedSlots()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any

  // Auto-recover stale active jobs (> 2h)
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: staleActive, error: staleError } = await supabase
    .from('queue_jobs')
    .select('id, started_at, created_at')
    .eq('status', 'active')
    .not('id', 'like', `${SLOT_PREFIX}%`)
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
    const { data: staleJobs, error: staleJobsError } = await supabase
      .from('queue_jobs')
      .select('run_id')
      .in('id', staleIds)
    if (staleJobsError) throw staleJobsError
    for (const row of staleJobs ?? []) await releaseQueueSlot(row.run_id as string)

    const base = process.env.INTERNAL_BASE_URL || 'http://localhost:3000'
    const { count: activeAfter, error: activeAfterError } = await supabase
      .from('queue_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .not('id', 'like', `${SLOT_PREFIX}%`)
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
        if (!(await tryActivateJob(job))) continue
        const response = await fetch(`${base}/api/queue/start`, {
          method: 'POST',
          headers: getInternalJsonHeaders(),
          body: JSON.stringify({ runId: job.runId, params: job.params }),
        })
        if (!response.ok) break
      }
    }
  }

  const [activeResult, waitingResult, recentResult] = await Promise.all([
    supabase.from('queue_jobs').select('id', { count: 'exact', head: true }).eq('status', 'active').not('id', 'like', `${SLOT_PREFIX}%`),
    supabase.from('queue_jobs').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
    supabase.from('queue_jobs').select('*').not('id', 'like', `${SLOT_PREFIX}%`).order('created_at', { ascending: false }).limit(50),
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
    .not('id', 'like', `${SLOT_PREFIX}%`)
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
    .not('id', 'like', `${SLOT_PREFIX}%`)
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
