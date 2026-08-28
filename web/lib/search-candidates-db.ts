import { createHash } from 'node:crypto'
import getSql from './db'
import { normalizeCandidateUrl, type SerperResultItem } from './serper'

export interface SearchCandidate {
  id: string
  projectId: string
  runId: string
  name: string
  url: string
  normalizedUrl: string
  source: SerperResultItem['source']
  keyword: string
  industry: string
  area: string
  address: string
  phone: string
  category: string
  verificationStatus: 'pending' | 'accepted' | 'hold' | 'rejected'
  verificationReasons: string[]
  verificationAttempts: number
  verifiedAt: string | null
  discoveredAt: string
}

export interface SearchCandidateFilters {
  projectId?: string
  runId?: string
  runIds?: string[]
  search?: string
  verificationStatus?: SearchCandidate['verificationStatus']
  industry?: string
  area?: string
  limit?: number
  offset?: number
}

function rowToCandidate(row: Record<string, unknown>): SearchCandidate {
  return {
    id: String(row.id ?? ''),
    projectId: String(row.project_id ?? ''),
    runId: String(row.run_id ?? ''),
    name: String(row.name ?? ''),
    url: String(row.url ?? ''),
    normalizedUrl: String(row.normalized_url ?? ''),
    source: String(row.source ?? 'organic') as SearchCandidate['source'],
    keyword: String(row.keyword ?? ''),
    industry: String(row.industry ?? ''),
    area: String(row.area ?? ''),
    address: String(row.address ?? ''),
    phone: String(row.phone ?? ''),
    category: String(row.category ?? ''),
    verificationStatus: String(row.verification_status ?? 'pending') as SearchCandidate['verificationStatus'],
    verificationReasons: Array.isArray(row.verification_reasons)
      ? row.verification_reasons.map(String)
      : [],
    verificationAttempts: Number(row.verification_attempts ?? 0),
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    discoveredAt: String(row.discovered_at ?? ''),
  }
}

export interface CandidateVerificationInput {
  url: string
  industry?: string
  sourceName?: string
  sourceTitle?: string
  source?: SerperResultItem['source']
  keywords?: string[]
  area?: string
  searchArea?: string
  sourceAddress?: string
  sourcePhone?: string
  sourceCategory?: string
}

/** Persist accepted/hold/rejected decisions so holds can be retried instead of disappearing. */
export async function upsertSearchCandidateVerifications(params: {
  projectId: string
  runId: string
  candidates: CandidateVerificationInput[]
  decisions: Array<{ status: 'accepted' | 'hold' | 'rejected'; reasons: string[] }>
}): Promise<number> {
  const now = new Date().toISOString()
  const inputs = params.candidates.map((candidate, index) => {
    const normalizedUrl = normalizeCandidateUrl(candidate.url)
    return { candidate, decision: params.decisions[index], normalizedUrl }
  }).filter((item) => item.normalizedUrl && item.decision)
  if (inputs.length === 0) return 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const existingAttempts = new Map<string, number>()
  const urls = [...new Set(inputs.map((item) => item.normalizedUrl))]
  for (let offset = 0; offset < urls.length; offset += 200) {
    const { data, error } = await supabase
      .from('search_candidates')
      .select('normalized_url, verification_attempts')
      .eq('run_id', params.runId)
      .in('normalized_url', urls.slice(offset, offset + 200))
    if (error) throw error
    for (const row of data ?? []) {
      existingAttempts.set(String(row.normalized_url), Number(row.verification_attempts ?? 0))
    }
  }

  const rows = inputs.map(({ candidate, decision, normalizedUrl }) => ({
    id: candidateId(params.runId, normalizedUrl),
    project_id: params.projectId,
    run_id: params.runId,
    name: candidate.sourceName?.trim() || candidate.sourceTitle?.trim() || normalizedUrl,
    url: candidate.url,
    normalized_url: normalizedUrl,
    source: candidate.source ?? 'organic',
    keyword: candidate.keywords?.[0] ?? '',
    industry: candidate.industry ?? '',
    area: candidate.searchArea || candidate.area || '',
    address: candidate.sourceAddress ?? '',
    phone: candidate.sourcePhone ?? '',
    category: candidate.sourceCategory ?? '',
    verification_status: decision.status,
    verification_reasons: decision.reasons,
    verification_attempts: (existingAttempts.get(normalizedUrl) ?? 0) + 1,
    verified_at: now,
    discovered_at: now,
  }))
  for (let offset = 0; offset < rows.length; offset += 200) {
    const { error } = await supabase
      .from('search_candidates')
      .upsert(rows.slice(offset, offset + 200), { onConflict: 'run_id,normalized_url' })
    if (error) throw error
  }
  return rows.length
}

function candidateId(runId: string, normalizedUrl: string): string {
  return `cand-${createHash('sha256').update(`${runId}\u0000${normalizedUrl}`).digest('hex').slice(0, 32)}`
}

export async function upsertSearchCandidates(params: {
  projectId: string
  runId: string
  candidates: SerperResultItem[]
  industry?: string
}): Promise<number> {
  const discoveredAt = new Date().toISOString()
  const deduped = new Map<string, SerperResultItem>()
  for (const candidate of params.candidates) {
    const normalizedUrl = normalizeCandidateUrl(candidate.link)
    if (!normalizedUrl) continue
    deduped.set(normalizedUrl, candidate)
  }
  const records = [...deduped].map(([normalizedUrl, candidate]) => ({
    id: candidateId(params.runId, normalizedUrl),
    project_id: params.projectId,
    run_id: params.runId,
    name: candidate.title?.trim() || normalizedUrl,
    url: candidate.link,
    normalized_url: normalizedUrl,
    source: candidate.source,
    keyword: candidate.keyword,
    industry: params.industry ?? '',
    area: candidate.area,
    address: candidate.address,
    phone: candidate.phone,
    category: candidate.category,
    discovered_at: discoveredAt,
  }))
  if (records.length === 0) return 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  for (let offset = 0; offset < records.length; offset += 200) {
    const { error } = await supabase
      .from('search_candidates')
      .upsert(records.slice(offset, offset + 200), { onConflict: 'run_id,normalized_url' })
    if (error) throw error
  }
  return records.length
}

async function matchingCandidates(filters: SearchCandidateFilters): Promise<SearchCandidate[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  let query = supabase.from('search_candidates').select('*')
  if (filters.projectId) query = query.eq('project_id', filters.projectId)
  if (filters.runId) query = query.eq('run_id', filters.runId)
  if (filters.runIds?.length) query = query.in('run_id', filters.runIds)
  if (filters.verificationStatus) query = query.eq('verification_status', filters.verificationStatus)
  if (filters.industry) query = query.eq('industry', filters.industry)
  if (filters.area) query = query.eq('area', filters.area)
  if (filters.search) {
    const escaped = filters.search.replace(/[%_,()]/g, ' ').trim()
    if (escaped) query = query.or(`name.ilike.%${escaped}%,url.ilike.%${escaped}%`)
  }
  const { data, error } = await query.order('discovered_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToCandidate)
}

/** Project-wide views dedupe URLs found in multiple runs. */
export async function getSearchCandidates(filters: SearchCandidateFilters = {}): Promise<{
  candidates: SearchCandidate[]
  total: number
}> {
  const matching = await matchingCandidates(filters)
  const seen = new Set<string>()
  const deduped = matching.filter((candidate) => {
    if (seen.has(candidate.normalizedUrl)) return false
    seen.add(candidate.normalizedUrl)
    return true
  })
  const offset = Math.max(0, filters.offset ?? 0)
  const limit = Math.max(1, Math.min(500, filters.limit ?? 100))
  return { candidates: deduped.slice(offset, offset + limit), total: deduped.length }
}

export async function getAllSearchCandidates(filters: Omit<SearchCandidateFilters, 'limit' | 'offset'>): Promise<SearchCandidate[]> {
  const matching = await matchingCandidates(filters)
  const seen = new Set<string>()
  return matching.filter((candidate) => {
    if (seen.has(candidate.normalizedUrl)) return false
    seen.add(candidate.normalizedUrl)
    return true
  })
}
