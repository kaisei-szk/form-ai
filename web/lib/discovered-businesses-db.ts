import { createHash } from 'node:crypto'
import getSql from './db'
import { businessDedupeKey, type PortalBusiness } from './portal-discovery'

export interface StoredDiscoveredBusiness extends PortalBusiness {
  id: string
  projectId: string
  runId: string
  industry: string
  area: string
  dedupeKey: string
  resolutionStatus: 'hp_not_found' | 'retry' | 'resolved' | 'exhausted'
  resolutionAttempts: number
  resolutionScore: number
  resolutionEvidence: string[]
  lastAttemptedAt: string | null
  discoveredAt: string
}

function rowToStoredBusiness(row: Record<string, unknown>): StoredDiscoveredBusiness {
  return {
    id: String(row.id ?? ''),
    projectId: String(row.project_id ?? ''),
    runId: String(row.run_id ?? ''),
    name: String(row.name ?? ''),
    address: String(row.address ?? ''),
    phone: String(row.phone ?? ''),
    industry: String(row.industry ?? ''),
    area: String(row.area ?? ''),
    category: String(row.category ?? ''),
    officialUrl: String(row.official_url ?? '') || null,
    portalHost: String(row.portal_host ?? ''),
    portalUrl: String(row.portal_url ?? ''),
    dedupeKey: String(row.dedupe_key ?? ''),
    resolutionStatus: String(row.resolution_status ?? 'hp_not_found') as StoredDiscoveredBusiness['resolutionStatus'],
    resolutionAttempts: Number(row.resolution_attempts ?? 0),
    resolutionScore: Number(row.resolution_score ?? 0),
    resolutionEvidence: Array.isArray(row.resolution_evidence)
      ? row.resolution_evidence.map(String)
      : [],
    lastAttemptedAt: row.last_attempted_at ? String(row.last_attempted_at) : null,
    discoveredAt: String(row.discovered_at ?? ''),
    discoveryId: String(row.id ?? ''),
  }
}

/**
 * ポータル等で実在を確認できたものの、公式HPをまだ特定できていない事業者を保存する。
 * companies/search_candidatesへポータルURLを公式HPとして混入させないための別テーブル。
 */
export async function upsertDiscoveredBusinesses(params: {
  projectId: string
  runId: string
  industry: string
  area: string
  businesses: PortalBusiness[]
}): Promise<number> {
  const discoveredAt = new Date().toISOString()
  const records = new Map<string, Record<string, unknown>>()

  for (const business of params.businesses) {
    const dedupeKey = businessDedupeKey(business.name, business.phone, business.address)
    if (!business.name || !dedupeKey) continue
    const id = `biz-${createHash('sha256').update(`${params.runId}\u0000${dedupeKey}`).digest('hex').slice(0, 32)}`
    records.set(id, {
      id,
      project_id: params.projectId,
      run_id: params.runId,
      name: business.name,
      address: business.address,
      phone: business.phone,
      industry: params.industry,
      area: params.area,
      category: business.category,
      portal_host: business.portalHost,
      portal_url: business.portalUrl,
      dedupe_key: dedupeKey,
      official_url: business.officialUrl ?? '',
      resolution_status: business.officialUrl ? 'resolved' : 'hp_not_found',
      resolution_attempts: 0,
      resolution_score: 0,
      resolution_evidence: [],
      last_attempted_at: null,
      resolved_at: business.officialUrl ? discoveredAt : null,
      last_error: '',
      discovered_at: discoveredAt,
    })
  }

  const rows = [...records.values()]
  if (rows.length === 0) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  for (let offset = 0; offset < rows.length; offset += 200) {
    const { error } = await supabase
      .from('discovered_businesses')
      // Never reset a previously resolved/retried row when another discovery
      // source reports the same business again in the same run.
      .upsert(rows.slice(offset, offset + 200), {
        onConflict: 'run_id,dedupe_key',
        ignoreDuplicates: true,
      })
    if (error) throw error
  }
  return rows.length
}

/** Retry candidates survive across runs and are processed least-attempted first. */
export async function getRetryableDiscoveredBusinesses(params: {
  projectId: string
  industry: string
  area: string
  limit?: number
  maxAttempts?: number
}): Promise<StoredDiscoveredBusiness[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const limit = Math.max(1, Math.min(5000, params.limit ?? 2500))
  const maxAttempts = Math.max(1, params.maxAttempts ?? 5)
  const { data, error } = await supabase
    .from('discovered_businesses')
    .select('*')
    .eq('project_id', params.projectId)
    .eq('industry', params.industry)
    .eq('area', params.area)
    .in('resolution_status', ['hp_not_found', 'retry'])
    .lt('resolution_attempts', maxAttempts)
    .order('resolution_attempts', { ascending: true })
    .order('discovered_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map(rowToStoredBusiness)
}

/** Persist the result of one resolution pass without losing the original source evidence. */
export async function recordDiscoveredBusinessAttempts(params: {
  attempted: StoredDiscoveredBusiness[]
  resolved: Array<{ discoveryId?: string; officialUrl: string; score?: number; evidence?: string[] }>
  maxAttempts?: number
}): Promise<{ resolved: number; retry: number; exhausted: number }> {
  if (params.attempted.length === 0) return { resolved: 0, retry: 0, exhausted: 0 }
  const resolvedById = new Map(
    params.resolved
      .filter((item): item is typeof item & { discoveryId: string } => Boolean(item.discoveryId))
      .map((item) => [item.discoveryId, item]),
  )
  const now = new Date().toISOString()
  const maxAttempts = Math.max(1, params.maxAttempts ?? 5)
  let resolved = 0
  let retry = 0
  let exhausted = 0
  const rows = params.attempted.map((business) => {
    const match = resolvedById.get(business.id)
    const attempts = business.resolutionAttempts + 1
    const status = match ? 'resolved' : attempts >= maxAttempts ? 'exhausted' : 'retry'
    if (status === 'resolved') resolved++
    else if (status === 'retry') retry++
    else exhausted++
    return {
      id: business.id,
      project_id: business.projectId,
      run_id: business.runId,
      name: business.name,
      address: business.address,
      phone: business.phone,
      industry: business.industry,
      area: business.area,
      category: business.category,
      portal_host: business.portalHost,
      portal_url: business.portalUrl,
      dedupe_key: business.dedupeKey,
      official_url: match?.officialUrl ?? business.officialUrl ?? '',
      resolution_status: status,
      resolution_attempts: attempts,
      resolution_score: match?.score ?? business.resolutionScore,
      resolution_evidence: match?.evidence ?? business.resolutionEvidence,
      last_attempted_at: now,
      resolved_at: match ? now : null,
      last_error: match ? '' : 'official_hp_not_resolved',
      discovered_at: business.discoveredAt,
    }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  for (let offset = 0; offset < rows.length; offset += 200) {
    const { error } = await supabase
      .from('discovered_businesses')
      .upsert(rows.slice(offset, offset + 200), { onConflict: 'id' })
    if (error) throw error
  }
  return { resolved, retry, exhausted }
}
