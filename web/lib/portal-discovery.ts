import {
  SKIP_DOMAINS,
  extractHost,
  fetchOrganicPage,
  isNonProductionHost,
  normalizeCandidateUrl,
  type SerperResultItem,
} from './serper.ts'
import { expandIndustryTerms } from './industry-synonyms.ts'
import { isAddressInArea } from './search-relevance.ts'

/**
 * ポータル・名簿サイトを「候補発見元」として活用するモジュール（精度目標.md）。
 *
 * 1. Serper organic でポータルの一覧ページを発見する
 * 2. 一覧ページから詳細ページを辿り、事業者名・住所・電話・カテゴリ・公式リンクを抽出する
 * 3. 同一事業者を名寄せする
 * 4. 公式リンクが無い事業者は Serper で公式HPを再検索する
 * 5. それでも見つからない事業者は「公式HP未発見」として別枠で返す
 */

export type PortalBusiness = {
  name: string
  address: string
  phone: string
  category: string
  officialUrl: string | null
  portalHost: string
  portalUrl: string
}

export interface PortalDiscoveryStats {
  portalQueriesExecuted: number
  portalFailedQueries: number
  discoveryOrganicResults: number
  listingPagesFound: number
  listingPagesFetched: number
  detailPagesFetched: number
  businessesExtracted: number
  dedupedBusinessCount: number
  officialLinkFromPortal: number
  officialFoundByResearch: number
  researchQueriesExecuted: number
  hpNotFoundCount: number
  fetchFailedCount: number
  deadlineReached: boolean
}

// ポータル一覧ページとして扱わないドメイン（SNS・検索・EC・ニュース系）
const NON_LISTING_HOSTS = new Set([
  'google.com', 'google.co.jp', 'youtube.com', 'wikipedia.org',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'linkedin.com',
  'amazon.co.jp', 'rakuten.co.jp', 'note.com', 'ameblo.jp', 'lit.link', 'linktr.ee',
  'prtimes.jp', 'value-press.com', 'yahoo.co.jp', 'map.yahoo.co.jp', 'loco.yahoo.co.jp',
  'indeed.com', 'wantedly.com', 'recruit.co.jp', 'mid-tenshoku.com', 'doda.jp',
  'en-gage.net', 'openwork.jp', 'careercross.com', 'careerticket.jp', 'job-medley.com',
])

const SNS_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'line.me', 'lin.ee', 'ameblo.jp', 'note.com', 'lit.link', 'linktr.ee',
])

const LISTING_TITLE_RE = /(?:一覧|ランキング|おすすめ|比較|口コミ|まとめ|検索|予約|サロン|店舗|厳選|\d+\s*(?:社|店|選|件))/iu
const EXPLICIT_LIST_COUNT_RE = /\d+\s*(?:社|店|選|件)/u
const LISTING_NAME_RE = /(?:一覧|ランキング|おすすめ|比較|口コミ|まとめ|検索結果|特集|厳選|費用|料金|相場|選び方|完全ガイド|徹底解説|カテゴリから|診断から|関連する記事|関連記事|\d+\s*(?:社|店|選|件))/iu
const NON_DETAIL_PATH_RE = /\/(?:posts?|articles?|blog|blogs|news|column|columns|guide|guides|category|categories|tag|tags|privacy|terms|contact|about|service)(?:\/|$)/iu

const ADDRESS_RE = /(?:北海道|東京都|(?:京都|大阪)府|[一-龠々]{2,3}県)[^<>"'。\n]{0,35}?(?:市|区|町|村)[^<>"'。\n]{0,45}/u
const PHONE_RE = /0\d{1,4}[-‐ー()（）\s]?\d{1,4}[-‐ー()（）\s]?\d{3,4}/u

function readBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s　・･,，.。/／\\|｜「」『』【】()（）［\]\[\]{}]/g, '')
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&(?:apos|#39);/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
}

function htmlToText(value: string): string {
  return decodeHtml(value
    .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(/<br\s*\/?\s*>/giu, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
}

function cleanHeading(value: string): string {
  return htmlToText(value)
    .replace(/^\s*(?:\d+(?:[-.．]\d+)*[.．]?|第\d+[章節])\s*/u, '')
    .trim()
}

function looksLikeListingName(name: string): boolean {
  return !name || name.length > 100 || LISTING_NAME_RE.test(name) || /[？?！!]$/u.test(name)
}

function usablePhone(raw: string): string {
  const match = raw.match(PHONE_RE)?.[0]?.trim() ?? ''
  const digits = match.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 11 ? match : ''
}

function usableAddress(raw: string): string {
  const text = htmlToText(raw).replace(/〒\s*\d{3}[-ー‐]?\d{4}\s*/u, '')
  const match = text.match(ADDRESS_RE)?.[0]?.trim() ?? ''
  if (!match || LISTING_NAME_RE.test(match)) return ''
  return match.split(/\s+(?:設立年|実績(?:ページ|詳細)?|価格感|資本金|代表者|URL|TEL|電話番号)/iu)[0].slice(0, 140)
}

function pageTitle(html: string): string {
  return cleanHeading(html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? '')
}

/** 名寄せ用の正規化名。括弧内の読み仮名や法人格表記を落とす。 */
export function coreBusinessName(name: string): string {
  return normalizeText(
    name
      .replace(/【[^】]*】|（[^）]*）|\([^)]*\)/gu, '')
      .replace(/(?:株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|\(株\)|㈱|\(有\)|㈲)/gu, ''),
  )
}

function phoneDigits(phone: string): string {
  return phone.normalize('NFKC').replace(/\D/g, '')
}

/** 電話番号があれば末尾9桁、なければ正規化名＋住所先頭で同一事業者を判定する。 */
export function businessDedupeKey(name: string, phone: string, address: string): string {
  const digits = phoneDigits(phone)
  if (digits.length >= 9) return `p:${digits.slice(-9)}`
  return `n:${coreBusinessName(name)}|${normalizeText(address).slice(0, 14)}`
}

function isBlockedHost(host: string): boolean {
  return !host
    || isNonProductionHost(host)
    || SKIP_DOMAINS.has(host)
    || [...SKIP_DOMAINS].some((domain) => host.endsWith(`.${domain}`))
}

function isPortalListingUrl(url: string, title: string): boolean {
  const host = extractHost(url)
  if (!host || NON_LISTING_HOSTS.has(host) || [...NON_LISTING_HOSTS].some((d) => host.endsWith(`.${d}`))) return false
  const knownPortal = SKIP_DOMAINS.has(host) || [...SKIP_DOMAINS].some((d) => host.endsWith(`.${d}`))
  if (knownPortal) return true
  if (EXPLICIT_LIST_COUNT_RE.test(title)) return true
  let path = ''
  try { path = new URL(url).pathname } catch { return false }
  // Unknown official-company blogs often publish "おすすめ" articles. Only
  // treat an unknown host as a listing source when both the title and URL have
  // a list/article structure. Content extraction later still has to find
  // individual business sections.
  return LISTING_TITLE_RE.test(title)
    && (/\/(?:posts?|articles?|column|columns|ranking|list|lists|search|categories)(?:\/|$)/iu.test(path)
      || /(?:portal|navi|search|ranking|comparison)/iu.test(host))
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (type && !/text\/html|application\/xhtml/i.test(type)) return null
    return await res.text()
  } catch {
    return null
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

// ── JSON-LD 抽出 ──────────────────────────────────────────

function* flattenJsonLd(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const child of node) yield* flattenJsonLd(child)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  yield obj
  if (obj['@graph']) yield* flattenJsonLd(obj['@graph'])
  if (obj.itemListElement) yield* flattenJsonLd(obj.itemListElement)
  if (obj.item) yield* flattenJsonLd(obj.item)
}

function jsonLdObjects(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    try {
      for (const obj of flattenJsonLd(JSON.parse(match[1].trim()))) out.push(obj)
    } catch {
      // 壊れたJSON-LDは無視
    }
  }
  return out
}

const BUSINESS_TYPE_RE = /business|salon|store|shop|spa|clinic|dentist|agency|restaurant|organization|corporation|company/i

function jsonLdTypeString(obj: Record<string, unknown>): string {
  const type = obj['@type']
  if (typeof type === 'string') return type
  if (Array.isArray(type)) return type.filter((t) => typeof t === 'string').join(' ')
  return ''
}

function jsonLdAddress(obj: Record<string, unknown>): string {
  const address = obj.address
  if (typeof address === 'string') return address.trim()
  if (address && typeof address === 'object') {
    const a = address as Record<string, unknown>
    return ['addressRegion', 'addressLocality', 'streetAddress']
      .map((key) => (typeof a[key] === 'string' ? (a[key] as string).trim() : ''))
      .filter(Boolean)
      .join('')
  }
  return ''
}

function extractSectionBusinesses(html: string, pageUrl: string): PortalBusiness[] {
  const portalHost = extractHost(pageUrl)
  const headings = [...html.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/giu)]
  const businesses: PortalBusiness[] = []

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]
    const name = cleanHeading(heading[2])
    if (looksLikeListingName(name)) continue
    const start = (heading.index ?? 0) + heading[0].length
    const end = headings[index + 1]?.index ?? html.length
    const section = html.slice(start, end)
    const address = usableAddress(section)
    const phone = usablePhone(htmlToText(section))
    const externalLinks = [...section.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>/giu)]
      .map(([, href]) => {
        try { return new URL(decodeHtml(href), pageUrl).toString() } catch { return '' }
      })
      .filter(Boolean)
    const officialUrl = pickOfficialUrl(externalLinks, portalHost)
    const hasCompanyMarker = /(?:株式会社|有限会社|合同会社|合資会社|法人|事務所|医院|クリニック|サロン|美容室|美容院|商店|店舗)/u.test(name)
    const hasStructuredProfile = /(?:会社所在地|店舗所在地|所在地|住所|電話|TEL|公式サイト|ホームページ|URL)/iu.test(htmlToText(section).slice(0, 2500))
    if (!hasCompanyMarker && !hasStructuredProfile) continue
    if (!address && !phone && !officialUrl) continue
    businesses.push({
      name,
      address,
      phone,
      category: pageTitle(html),
      officialUrl,
      portalHost,
      portalUrl: pageUrl,
    })
  }
  return businesses
}

function pickOfficialUrl(candidates: Array<unknown>, portalHost: string): string | null {
  for (const raw of candidates) {
    if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw)) continue
    const host = extractHost(raw)
    if (!host || host === portalHost || host.endsWith(`.${portalHost}`)) continue
    if (SNS_HOSTS.has(host) || [...SNS_HOSTS].some((d) => host.endsWith(`.${d}`))) continue
    if (isBlockedHost(host)) continue
    return raw
  }
  return null
}

/** 詳細/一覧ページのHTMLから事業者情報を抽出する（JSON-LD優先・HTMLフォールバック）。 */
export function extractBusinessesFromHtml(html: string, pageUrl: string): PortalBusiness[] {
  const portalHost = extractHost(pageUrl)
  const businesses: PortalBusiness[] = []
  const documentTitle = pageTitle(html)

  for (const obj of jsonLdObjects(html)) {
    const typeString = jsonLdTypeString(obj)
    if (!typeString || !BUSINESS_TYPE_RE.test(typeString)) continue
    const name = typeof obj.name === 'string' ? obj.name.trim() : ''
    if (!name || looksLikeListingName(name) || normalizeText(name) === normalizeText(documentTitle)) continue
    const address = usableAddress(jsonLdAddress(obj))
    const phone = usablePhone(typeof obj.telephone === 'string' ? obj.telephone.trim() : '')
    if (!address && !phone) continue
    const sameAs = Array.isArray(obj.sameAs) ? obj.sameAs : typeof obj.sameAs === 'string' ? [obj.sameAs] : []
    const officialUrl = pickOfficialUrl([obj.url, ...sameAs], portalHost)
    businesses.push({
      name,
      address,
      phone,
      category: typeString,
      officialUrl,
      portalHost,
      portalUrl: pageUrl,
    })
  }
  businesses.push(...extractSectionBusinesses(html, pageUrl))
  if (businesses.length > 0) {
    const unique = new Map<string, PortalBusiness>()
    for (const business of businesses) {
      unique.set(businessDedupeKey(business.name, business.phone, business.address), business)
    }
    return [...unique.values()]
  }

  // JSON-LDが無い詳細ページ向けフォールバック: title＋住所・電話の正規表現
  const rawTitle = documentTitle
  const name = rawTitle.split(/[|｜«»/／]/u)[0]?.trim() ?? ''
  // 「◯◯一覧」「検索結果」のような一覧見出しは事業者名として扱わない
  if (looksLikeListingName(name)) return []
  const text = htmlToText(html)
  const address = usableAddress(text)
  const phone = usablePhone(text)
  if (!address && !phone) return []
  const officialLink = [...html.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)]
    .filter(([, , label]) => /公式|オフィシャル|ホームページ|公式サイト|website/iu.test(label.replace(/<[^>]+>/g, '')))
    .map(([, href]) => href)
  return [{
    name,
    address,
    phone,
    category: '',
    officialUrl: pickOfficialUrl(officialLink, portalHost),
    portalHost,
    portalUrl: pageUrl,
  }]
}

/**
 * 一覧ページ内で最も多く繰り返される同一ホストのリンクパターンを
 * 詳細ページ群とみなして返す。ポータル固有のセレクタに依存しない。
 */
export function extractDetailLinks(html: string, baseUrl: string, cap = 60): string[] {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }
  const baseHost = base.hostname.replace(/^www\./, '')
  const groups = new Map<string, Set<string>>()
  for (const [, href] of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    let abs: URL
    try {
      abs = new URL(href, base)
    } catch {
      continue
    }
    if (!/^https?:$/.test(abs.protocol)) continue
    if (abs.hostname.replace(/^www\./, '') !== baseHost) continue
    const path = abs.pathname.replace(/\/$/, '')
    if (!path || path === base.pathname.replace(/\/$/, '')) continue
    if (NON_DETAIL_PATH_RE.test(path)) continue
    const pattern = path
      .split('/')
      .map((segment) => (/\d/.test(segment) ? 'N' : segment.length > 6 ? 'S' : segment))
      .join('/')
    const set = groups.get(pattern) ?? new Set<string>()
    set.add(abs.origin + path)
    groups.set(pattern, set)
  }
  const best = [...groups.values()].sort((a, b) => b.size - a.size)[0]
  if (!best || best.size < 8) return []
  return [...best].slice(0, cap)
}

/** 一覧ページのページネーションリンク（?page=2 等）を同一ホストで抽出する。 */
function extractPaginationLinks(html: string, baseUrl: string, cap = 10): string[] {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }
  const baseHost = base.hostname.replace(/^www\./, '')
  const found = new Set<string>()
  for (const [, href] of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    let abs: URL
    try {
      abs = new URL(href, base)
    } catch {
      continue
    }
    if (abs.hostname.replace(/^www\./, '') !== baseHost) continue
    const full = abs.pathname + abs.search
    if (/[?&](?:page|p|pn|pageno)=\d+/i.test(abs.search) || /\/(?:page|pg|pn)[\/=-]?\d+/i.test(abs.pathname)) {
      found.add(abs.toString())
      if (found.size >= cap) break
    }
  }
  return [...found]
}

// 業種・地域を表す一般語。ドメインと事業者名の照合では固有名の証拠にならない。
const GENERIC_NAME_TOKENS = new Set([
  'hair', 'salon', 'salons', 'beauty', 'barber', 'head', 'spa', 'esthe', 'nail',
  'clinic', 'dental', 'office', 'shop', 'store', 'group', 'japan', 'tokyo', 'osaka',
])

function properNameTokens(name: string): string[] {
  const normalized = name.normalize('NFKC').toLowerCase()
  return (normalized.match(/[a-z0-9]{3,}/g) ?? []).filter((token) => !GENERIC_NAME_TOKENS.has(token))
}

// 公式HPは通常ドメイン直下か浅いパスにある。深い階層・数字ID・クエリ付きURLは
// 未知のポータルの掲載詳細ページである可能性が高い（特定サイト名に依存しない構造判定）。
export function isShallowSiteUrl(link: string): boolean {
  try {
    const url = new URL(link)
    if (url.search) return false
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length > 1) return false
    return !segments.some((segment) => /\d{3,}/.test(segment))
  } catch {
    return false
  }
}

export function domainMatchesBusinessName(host: string, name: string): boolean {
  return properNameTokens(name).some((token) => host.includes(token))
}

async function researchOfficialUrl(
  business: PortalBusiness,
  area: string,
  apiKey: string,
  stats: PortalDiscoveryStats,
): Promise<string | null> {
  // 精度目標.md 公式HPの検索方法: 事業者名＋地区 / 事業者名＋電話番号
  const queries = [
    ...(business.phone ? [`${business.name} ${business.phone}`] : []),
    ...(business.address ? [`${business.name} ${business.address}`] : []),
    `${business.name} ${area} 公式`,
  ]
  const core = coreBusinessName(business.name)

  for (const query of queries) {
    const response = await fetchOrganicPage(query, 1, apiKey)
    stats.researchQueriesExecuted++
    if (response.error) continue
    for (const result of response.organic ?? []) {
      const link = result.link?.trim() ?? ''
      const host = extractHost(link)
      if (!link || isBlockedHost(host)) continue
      if (NON_LISTING_HOSTS.has(host) || SNS_HOSTS.has(host)) continue
      // 深いURLは未知ポータルの掲載ページの疑いが強い。ドメイン名が事業者の
      // 固有名を含む場合（グループ公式サイト配下の店舗ページ等）のみ許容する。
      if (!isShallowSiteUrl(link) && !domainMatchesBusinessName(host, business.name)) continue
      const title = normalizeText(result.title ?? '')
      // 検索順位だけでは確定しない。タイトルに事業者名が含まれる場合のみ候補にする。
      if (core.length >= 2 && (title.includes(core) || core.includes(title.slice(0, 20)) && title.length >= 4)) {
        return link
      }
    }
  }
  return null
}

export async function runPortalDiscovery(params: {
  keywords: string[]
  area: string
  apiKey: string
  deadline: number
  existingKeys?: Set<string>
  existingHosts?: Set<string>
  // ポータル以外の経路（Placesのwebsite無し事業者など）で見つかった事業者。
  // 名寄せ・公式HP再検索・HP未発見バケットのパイプラインに合流させる。
  extraBusinesses?: PortalBusiness[]
}): Promise<{
  candidates: SerperResultItem[]
  hpNotFound: PortalBusiness[]
  stats: PortalDiscoveryStats
}> {
  const stats: PortalDiscoveryStats = {
    portalQueriesExecuted: 0,
    portalFailedQueries: 0,
    discoveryOrganicResults: 0,
    listingPagesFound: 0,
    listingPagesFetched: 0,
    detailPagesFetched: 0,
    businessesExtracted: 0,
    dedupedBusinessCount: 0,
    officialLinkFromPortal: 0,
    officialFoundByResearch: 0,
    researchQueriesExecuted: 0,
    hpNotFoundCount: 0,
    fetchFailedCount: 0,
    deadlineReached: false,
  }

  const listingLimit = readBoundedInt(process.env.SERPER_PORTAL_LISTING_LIMIT, 12, 1, 60)
  const detailLimit = readBoundedInt(process.env.SERPER_PORTAL_DETAIL_LIMIT, 120, 10, 2000)
  const researchLimit = readBoundedInt(process.env.SERPER_PORTAL_RESEARCH_LIMIT, 200, 0, 2000)
  const fetchConcurrency = readBoundedInt(process.env.SERPER_PORTAL_FETCH_CONCURRENCY, 6, 1, 12)
  const fetchTimeoutMs = 15_000
  const hasTime = (marginMs = 20_000) => Date.now() < params.deadline - marginMs
  const outOfTime = () => {
    stats.deadlineReached = true
  }

  // ── 1. ポータル一覧ページの発見 ─────────────────────────
  const listingUrls: string[] = []
  const seenListingUrls = new Set<string>()
  // 同義語（美容室↔美容院↔ヘアサロン等）の一覧ページも探索対象に含める
  const portalKeywords = expandIndustryTerms(params.keywords).slice(0, 6)
  const discoveryQueries = portalKeywords.flatMap((keyword) => [
    `${keyword} ${params.area}`,
    `${keyword} ${params.area} 一覧`,
  ])

  for (const query of discoveryQueries) {
    if (listingUrls.length >= listingLimit) break
    if (!hasTime()) {
      outOfTime()
      break
    }
    const response = await fetchOrganicPage(query, 1, params.apiKey)
    stats.portalQueriesExecuted++
    if (response.error) {
      stats.portalFailedQueries++
      continue
    }
    stats.discoveryOrganicResults += (response.organic ?? []).length
    for (const result of response.organic ?? []) {
      const link = result.link?.trim() ?? ''
      const normalized = normalizeCandidateUrl(link)
      if (!normalized || seenListingUrls.has(normalized)) continue
      if (!isPortalListingUrl(link, result.title ?? '')) continue
      seenListingUrls.add(normalized)
      listingUrls.push(link)
      if (listingUrls.length >= listingLimit) break
    }
  }
  stats.listingPagesFound = listingUrls.length

  // ── 2. 一覧・詳細ページの取得と事業者抽出 ───────────────
  const extracted: PortalBusiness[] = []
  const detailQueue: string[] = []
  const seenDetailUrls = new Set<string>()
  const listingQueue = [...listingUrls]
  const processedListings = new Set<string>()

  while (listingQueue.length > 0 && processedListings.size < listingLimit) {
    if (!hasTime()) {
      outOfTime()
      break
    }
    const batch = listingQueue.splice(0, fetchConcurrency)
      .filter((url) => !processedListings.has(normalizeCandidateUrl(url)))
    if (batch.length === 0) continue
    for (const url of batch) processedListings.add(normalizeCandidateUrl(url))

    const pages = await mapWithConcurrency(batch, fetchConcurrency, async (url) => ({
      url,
      html: await fetchHtml(url, fetchTimeoutMs),
    }))
    for (const { url, html } of pages) {
      stats.listingPagesFetched++
      if (!html) {
        stats.fetchFailedCount++
        continue
      }
      // 一覧記事は見出し単位で個別事業者を抽出する。複数社を直接抽出
      // できた場合、関連記事群を「詳細ページ」と誤認して辿らない。
      const pageBusinesses = extractBusinessesFromHtml(html, url)
      extracted.push(...pageBusinesses)
      const detailLinks = pageBusinesses.length >= 2 ? [] : extractDetailLinks(html, url)
      for (const detailUrl of detailLinks) {
        const normalized = normalizeCandidateUrl(detailUrl)
        if (!normalized || seenDetailUrls.has(normalized)) continue
        seenDetailUrls.add(normalized)
        if (detailQueue.length < detailLimit) detailQueue.push(detailUrl)
      }
      for (const nextPage of extractPaginationLinks(html, url)) {
        const normalized = normalizeCandidateUrl(nextPage)
        if (normalized && !processedListings.has(normalized) && listingQueue.length + processedListings.size < listingLimit) {
          listingQueue.push(nextPage)
        }
      }
    }
  }

  for (let offset = 0; offset < detailQueue.length; offset += fetchConcurrency) {
    if (!hasTime()) {
      outOfTime()
      break
    }
    const batch = detailQueue.slice(offset, offset + fetchConcurrency)
    const pages = await mapWithConcurrency(batch, fetchConcurrency, async (url) => ({
      url,
      html: await fetchHtml(url, fetchTimeoutMs),
    }))
    for (const { url, html } of pages) {
      stats.detailPagesFetched++
      if (!html) {
        stats.fetchFailedCount++
        continue
      }
      extracted.push(...extractBusinessesFromHtml(html, url))
    }
  }
  stats.businessesExtracted = extracted.length
  extracted.push(...(params.extraBusinesses ?? []))

  // ── 3. 名寄せ・重複統合 ─────────────────────────────────
  const deduped = new Map<string, PortalBusiness>()
  for (const business of extracted) {
    if (!business.name) continue
    // A portal article can cover a wider area than the requested municipality.
    // Keep businesses with an exact in-area address, or those without an
    // address so the official site can provide the missing evidence later.
    if (business.address && !isAddressInArea(business.address, params.area)) continue
    const key = businessDedupeKey(business.name, business.phone, business.address)
    if (params.existingKeys?.has(key)) continue
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, business)
      continue
    }
    // 情報が多い方を残す（公式リンク > 住所 > 電話の順で補完）
    deduped.set(key, {
      ...existing,
      address: existing.address || business.address,
      phone: existing.phone || business.phone,
      category: existing.category || business.category,
      officialUrl: existing.officialUrl ?? business.officialUrl,
    })
  }
  stats.dedupedBusinessCount = deduped.size

  // ── 4. 公式リンク確認と再検索 ───────────────────────────
  const candidates: SerperResultItem[] = []
  const hpNotFound: PortalBusiness[] = []
  const seenHosts = new Set(params.existingHosts ?? [])
  const needResearch: PortalBusiness[] = []

  const pushCandidate = (business: PortalBusiness, officialUrl: string) => {
    const host = extractHost(officialUrl)
    if (isBlockedHost(host) || seenHosts.has(host)) return false
    seenHosts.add(host)
    candidates.push({
      link: officialUrl,
      title: business.name,
      snippet: '',
      keyword: params.keywords[0] ?? '',
      area: params.area,
      source: 'portal',
      address: business.address,
      phone: business.phone,
      category: business.category,
      placeId: `portal:${business.portalHost}:${businessDedupeKey(business.name, business.phone, business.address)}`,
    })
    return true
  }

  for (const business of deduped.values()) {
    if (business.officialUrl) {
      if (pushCandidate(business, business.officialUrl)) {
        stats.officialLinkFromPortal++
        continue
      }
    }
    needResearch.push(business)
  }

  let processedCount = 0
  while (processedCount < needResearch.length && processedCount < researchLimit) {
    if (!hasTime()) {
      outOfTime()
      break
    }
    const batch = needResearch.slice(processedCount, processedCount + 5)
    const found = await mapWithConcurrency(batch, 5, async (business) => ({
      business,
      officialUrl: await researchOfficialUrl(business, params.area, params.apiKey, stats),
    }))
    processedCount += batch.length
    for (const { business, officialUrl } of found) {
      if (officialUrl && pushCandidate(business, officialUrl)) {
        stats.officialFoundByResearch++
      } else {
        hpNotFound.push(business)
      }
    }
  }
  // 予算・時間切れで再検索できなかった分も「公式HP未発見」に含める
  hpNotFound.push(...needResearch.slice(processedCount))

  stats.hpNotFoundCount = hpNotFound.length
  return { candidates, hpNotFound, stats }
}
