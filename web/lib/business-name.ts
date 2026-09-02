const GENERIC_NAME_RE = /^(?:会社概要|企業情報|法人概要|店舗情報|サロン情報|運営会社|お問い合わせ(?:フォーム)?|お問(?:い)?合(?:わ)?せ(?:フォーム)?|ご相談(?:フォーム)?|contact(?:\s*us|\s*form)?|inquiry(?:\s*form)?|about(?:\s*us)?|company(?:\s*(?:profile|overview))?|corporate(?:\s*(?:profile|site))?|profile|home|top|index|公式(?:サイト|ホームページ)|ホームページ)$/iu
const GENERIC_PART_RE = /(?:会社概要|企業情報|法人概要|店舗情報|サロン情報|運営会社|お問い合わせ|お問(?:い)?合(?:わ)?せ|ご相談|contact(?:\s*us|\s*form)?|inquiry(?:\s*form)?|about(?:\s*us)?|company\s*(?:profile|overview)|corporate\s*(?:profile|site))/iu
const BAD_ASSET_RE = /(?:ロゴ(?:画像)?|logo(?:\s*image)?|バナー(?:画像)?|メインビジュアル|キービジュアル)$/iu
const LEGAL_ENTITY_RE = /(?:株式会社|有限会社|合同会社|合資会社|合名会社|相互会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|社会福祉法人|学校法人|宗教法人|特定非営利活動法人|NPO法人|弁護士法人|税理士法人|司法書士法人|行政書士法人|監査法人|(?:^|[\s,])(incorporated|inc\.?|limited|ltd\.?|llc|corporation|corp\.?|company|co\.?)(?:$|[\s,]))/iu

const BUSINESS_SCHEMA_TYPES = new Set([
  'organization', 'corporation', 'localbusiness', 'professionalservice',
  'store', 'hairsalon', 'beautysalon', 'medicalorganization',
  'dentist', 'legalservice', 'financialservice', 'employmentagency',
])

export interface BusinessNameExtraction {
  name: string
  source: 'jsonld_legal_name' | 'jsonld_name' | 'company_label' | 'site_name' | 'title'
  score: number
}

interface Candidate extends BusinessNameExtraction {
  order: number
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  }
  return value
    .replace(/&#(\d+);?/g, (_, raw: string) => String.fromCodePoint(Number(raw)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, raw: string) => String.fromCodePoint(Number.parseInt(raw, 16)))
    .replace(/&([a-z]+);/gi, (match, key: string) => named[key.toLowerCase()] ?? match)
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCandidate(value: unknown): string {
  if (typeof value !== 'string') return ''
  return stripTags(value)
    .normalize('NFKC')
    .replace(/^(?:会社名|社名|商号|法人名|屋号|店舗名|施設名|運営会社)\s*[:：]?\s*/u, '')
    .replace(/\s*(?:ロゴ(?:画像)?|logo(?:\s*image)?)$/iu, '')
    .replace(/^[|｜–—・:：\s]+|[|｜–—・:：\s]+$/g, '')
    .trim()
}

function isUsableCandidate(name: string): boolean {
  if (!name || name.length < 2 || name.length > 120) return false
  if (GENERIC_NAME_RE.test(name) || BAD_ASSET_RE.test(name)) return false
  if (/^(?:https?:\/\/|www\.)/i.test(name)) return false
  if (/[。！？]{2,}/u.test(name)) return false
  if ((name.match(/[|｜]/g) ?? []).length >= 2) return false
  return true
}

export function isSuspiciousBusinessName(value: string | null | undefined): boolean {
  const rawName = stripTags(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (BAD_ASSET_RE.test(rawName)) return true
  const name = normalizeCandidate(rawName)
  if (!name || GENERIC_NAME_RE.test(name) || BAD_ASSET_RE.test(name)) return true
  if (GENERIC_PART_RE.test(name)) return true
  if (/[|｜。！？〜～]/u.test(name)) return true
  if (/(?:コーポレート|オフィシャル|公式)(?:サイト|ホームページ|ロゴ)/iu.test(name)) return true
  if (name.length > 70) return true
  if (/^(?:公式|official)\s*(?:web)?site$/iu.test(name)) return true
  return false
}

function schemaTypes(entry: Record<string, unknown>): string[] {
  const raw = entry['@type']
  return (Array.isArray(raw) ? raw : [raw])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.split(/[\/#]/).pop()?.toLowerCase() ?? '')
    .filter(Boolean)
}

function extractJsonLdCandidates(html: string, add: (name: unknown, source: Candidate['source'], score: number) => void): void {
  const scriptRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  let visited = 0

  const walk = (value: unknown, depth = 0) => {
    if (depth > 8 || visited++ > 500 || value === null) return
    if (Array.isArray(value)) {
      for (const child of value) walk(child, depth + 1)
      return
    }
    if (typeof value !== 'object') return
    const object = value as Record<string, unknown>
    const types = schemaTypes(object)
    const business = types.some((type) => BUSINESS_SCHEMA_TYPES.has(type) || type.endsWith('business'))
    if (business) {
      add(object.legalName, 'jsonld_legal_name', 120)
      add(object.name, 'jsonld_name', 105)
    }
    for (const key of ['@graph', 'mainEntity', 'publisher', 'provider', 'parentOrganization', 'subOrganization']) {
      if (key in object) walk(object[key], depth + 1)
    }
  }

  while ((match = scriptRe.exec(html)) !== null) {
    try { walk(JSON.parse(decodeHtmlEntities(match[1]))) } catch { /* malformed JSON-LD */ }
  }
}

function extractMetaContent(html: string, key: string): string[] {
  const values: string[] = []
  const metaRe = /<meta\b[^>]*>/gi
  for (const tag of html.match(metaRe) ?? []) {
    const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
    if (property !== key.toLowerCase()) continue
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]
    if (content) values.push(content)
  }
  return values
}

export function extractOfficialBusinessName(html: string): BusinessNameExtraction | null {
  if (!html) return null
  const candidates: Candidate[] = []
  let order = 0
  const add = (raw: unknown, source: Candidate['source'], score: number) => {
    const name = normalizeCandidate(raw)
    if (!isUsableCandidate(name)) return
    let adjusted = score
    if (LEGAL_ENTITY_RE.test(name)) adjusted += 25
    if (GENERIC_PART_RE.test(name)) adjusted -= 60
    candidates.push({ name, source, score: adjusted, order: order++ })
  }

  extractJsonLdCandidates(html, add)

  // Company/profile tables and definition lists are the strongest visible-page
  // evidence when JSON-LD is absent.
  const labeledPairs = [
    /<(?:th|dt)\b[^>]*>\s*(?:会社名|社名|商号|法人名|屋号|店舗名|施設名|運営会社)\s*[:：]?\s*<\/(?:th|dt)>\s*<(?:td|dd)\b[^>]*>([\s\S]*?)<\/(?:td|dd)>/gi,
    /<(?:div|p|span)\b[^>]*>\s*(?:会社名|社名|商号|法人名|屋号|店舗名|施設名|運営会社)\s*[:：]?\s*<\/(?:div|p|span)>\s*<(?:div|p|span)\b[^>]*>([\s\S]*?)<\/(?:div|p|span)>/gi,
  ]
  for (const pairRe of labeledPairs) {
    let match: RegExpExecArray | null
    while ((match = pairRe.exec(html)) !== null) add(match[1], 'company_label', 112)
  }

  for (const siteName of extractMetaContent(html, 'og:site_name')) add(siteName, 'site_name', 82)
  for (const appName of extractMetaContent(html, 'application-name')) add(appName, 'site_name', 78)

  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  const titleParts = stripTags(title).split(/\s*[|｜–—]\s*|\s+-\s+/).filter(Boolean)
  for (const part of titleParts) add(part, 'title', 60)

  candidates.sort((a, b) => b.score - a.score || a.order - b.order)
  const best = candidates[0]
  return best ? { name: best.name, source: best.source, score: best.score } : null
}

export function chooseBestOfficialBusinessName(
  pages: Array<{ html: string }>,
): BusinessNameExtraction | null {
  const extracted = pages
    .map((page) => extractOfficialBusinessName(page.html))
    .filter((item): item is BusinessNameExtraction => item !== null)
    .sort((a, b) => b.score - a.score)
  return extracted[0] ?? null
}

export function extractCompanyPageLinks(html: string, baseUrl: string): string[] {
  let base: URL
  try { base = new URL(baseUrl) } catch { return [] }
  const links: Array<{ url: string; score: number }> = []
  const anchorRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchorRe.exec(html)) !== null) {
    let target: URL
    try { target = new URL(decodeHtmlEntities(match[1]), base) } catch { continue }
    if (!/^https?:$/.test(target.protocol) || target.origin !== base.origin) continue
    const text = stripTags(match[2]).toLowerCase()
    const path = (() => { try { return decodeURIComponent(target.pathname) } catch { return target.pathname } })().toLowerCase()
    const signal = `${text} ${path}`
    let score = 0
    if (/(?:会社概要|法人概要|企業概要|company\s*(?:profile|overview)|corporate\s*profile)/iu.test(signal)) score = 30
    else if (/(?:企業情報|会社情報|運営会社|about\s*us|\/company(?:\/|$)|\/corporate(?:\/|$)|\/profile(?:\/|$))/iu.test(signal)) score = 20
    if (!score) continue
    target.hash = ''
    links.push({ url: target.toString(), score })
  }
  return [...new Map(links.sort((a, b) => b.score - a.score).map((item) => [item.url, item])).values()]
    .slice(0, 2)
    .map((item) => item.url)
}
