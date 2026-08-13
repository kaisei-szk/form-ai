import getSql from './db'
import { pruneOldJobs } from './run-queue'

export interface MaintenanceResult {
  vacuumDone: boolean
  prunedRows?: number
}

export interface PruneOptions {
  daysOld?: number
  statuses?: string[]
}

export async function pruneOldData(opts: PruneOptions = {}): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const daysOld = opts.daysOld ?? 90
  const statuses = opts.statuses ?? ['送信済み', 'スキップ']
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysOld)
  const cutoffIso = cutoff.toISOString()

  let query = supabase.from('companies').delete().lt('collected_at', cutoffIso).select('id')
  if (statuses.length > 0) query = query.in('status', statuses)

  const { data, error } = await query
  if (error) throw error
  return data?.length ?? 0
}

export async function runMaintenance(): Promise<MaintenanceResult> {
  await pruneOldJobs()
  return { vacuumDone: false }
}
