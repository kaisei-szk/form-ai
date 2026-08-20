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
  area: string
  address: string
  phone: string
  category: string
  discoveredAt: string
}

export interface SearchCandidateFilters {
  projectId?: string
  runId?: string
  runIds?: string[]
  search?: string
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
    area: String(row.area ?? ''),
    address: String(row.address ?? ''),
    phone: String(row.phone ?? ''),
    category: String(row.category ?? ''),
    discoveredAt: String(row.discovered_at ?? ''),
  }
}

function candidateId(runId: string, normalizedUrl: string): string {
  return `cand-${createHash('sha256').update(`${runId}\u0000${normalizedUrl}`).digest('hex').slice(0, 32)}`
}

export async function upsertSearchCandidates(params: {
  projectId: string
  runId: string
  candidates: SerperResultItem[]
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
