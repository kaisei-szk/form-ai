import {
  SKIP_DOMAINS,
  extractHost,
  fetchOrganicPage,
  isNonOfficialOrganicTitle,
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
  /** Present when this business was loaded from the retry table. */
  discoveryId?: string
}

export type ResolvedPortalBusiness = PortalBusiness & {
  officialUrl: string
  resolutionScore: number
  resolutionEvidence: string[]
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
  hotPepperEnabled: boolean
  hotPepperListingPagesFetched: number
  hotPepperBusinessesEnumerated: number
  hotPepperDetailPagesFetched: number
  hotPepperDetailFetchFailedCount: number
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

type HtmlFetchResult = { html: string | null; cookie: string }

function responseCookieHeader(headers: Headers): string {
  const extended = headers as Headers & { getSetCookie?: () => string[] }
  const values = extended.getSetCookie?.()
    ?? (headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=[^;])/u).filter(Boolean)
  return values
    .map((value) => value.split(';')[0]?.trim() ?? '')
    .filter((value) => /^[^=\s]+=/u.test(value))
    .join('; ')
}

async function fetchHtmlResponse(url: string, timeoutMs: number, cookie = ''): Promise<HtmlFetchResult> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.8',
        ...(cookie && { Cookie: cookie }),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { html: null, cookie }
    const type = res.headers.get('content-type') ?? ''
    if (type && !/text\/html|application\/xhtml/i.test(type)) return { html: null, cookie }
    return {
      html: await res.text(),
      cookie: responseCookieHeader(res.headers) || cookie,
    }
  } catch {
    return { html: null, cookie }
  }
}

async function fetchHtml(url: string, timeoutMs: number, cookie = ''): Promise<string | null> {
  return (await fetchHtmlResponse(url, timeoutMs, cookie)).html
}

const HOTPEPPER_HOST = 'beauty.hotpepper.jp'
const HOTPEPPER_INDUSTRY_RE = /(?:美容室|美容院|ヘア(?:ー)?サロン|ヘアデザイン|ヘアカット|カラー専門店|パーマ専門店|トリートメントサロン|ヘッドスパ|ネイル|まつげ|マツエク|アイラッシュ|エステ|リラクゼーション|マッサージ|もみほぐし|整体)/iu

/** Hot Pepper Beautyに掲載カテゴリがある業種だけ専用収集を有効にする。 */
export function supportsHotPepper(keywords: string[]): boolean {
  return keywords.some((keyword) => HOTPEPPER_INDUSTRY_RE.test(keyword))
}

/** 検索結果やPNページから、市区町村別一覧の先頭URLへ正規化する。 */
export function normalizeHotPepperListingUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.hostname.replace(/^www\./, '') !== HOTPEPPER_HOST) return null
    const match = url.pathname.match(/^\/(?:(nail|relax|esthe)\/)?pre\d+\/city\d+\/(?:PN\d+\/)?$/iu)
    if (!match) return null
    const section = match[1] ? `${match[1].toLowerCase()}/` : ''
    const areaPath = url.pathname.match(/pre\d+\/city\d+\//iu)?.[0]
    return areaPath ? `${url.origin}/${section}${areaPath}` : null
  } catch {
    return null
  }
}

function hotPepperPageUrl(listingUrl: string, page: number): string {
  return page <= 1 ? listingUrl : `${listingUrl.replace(/\/$/, '')}/PN${page}/`
}

function hotPepperListingUrlsInHtml(html: string): string[] {
  const found = new Set<string>()
  for (const match of html.matchAll(/https?:\/\/beauty\.hotpepper\.jp\/(?:nail\/|relax\/|esthe\/)?pre\d+\/city\d+\/(?:PN\d+\/)?/giu)) {
    const normalized = normalizeHotPepperListingUrl(match[0])
    if (normalized) found.add(normalized)
  }
  return [...found]
}

function hotPepperAddressByStoreId(html: string): Map<string, string> {
  const addresses = new Map<string, string>()
  for (const obj of jsonLdObjects(html)) {
    const location = obj.location
    if (!location || typeof location !== 'object') continue
    const place = location as Record<string, unknown>
    const url = typeof place.url === 'string' ? place.url : ''
    const storeId = url.match(/sln(H\d+)/iu)?.[1]
    const addressObj = place.address
    const address = addressObj && typeof addressObj === 'object'
      ? String((addressObj as Record<string, unknown>).name ?? '')
      : ''
    if (storeId && address) addresses.set(storeId.toUpperCase(), usableAddress(address))
  }
  return addresses
}

/** Hot Pepperの一覧1ページから、店舗単位の候補と総ページ数を抽出する。 */
export function extractHotPepperListingPage(
  html: string,
  pageUrl: string,
  category: string,
): { businesses: PortalBusiness[]; totalPages: number } {
  const totalPages = Math.max(1, Number.parseInt(html.match(/\d+\s*\/\s*(\d+)\s*ページ/u)?.[1] ?? '1', 10))
  const addresses = hotPepperAddressByStoreId(html)
  const businesses = new Map<string, PortalBusiness>()
  const headingRe = /<h3\b[^>]*class=["'][^"']*slnName[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']*\/slnH\d+\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/giu
  let match: RegExpExecArray | null
  while ((match = headingRe.exec(html))) {
    let detailUrl = ''
    try {
      const parsed = new URL(decodeHtml(match[1]), pageUrl)
      const storePath = parsed.pathname.match(/\/sln(H\d+)\//iu)
      if (!storePath) continue
      detailUrl = `${parsed.origin}/sln${storePath[1].toUpperCase()}/`
      const name = cleanHeading(match[2])
      if (!name) continue
      const storeId = storePath[1].toUpperCase()
      businesses.set(storeId, {
        name,
        address: addresses.get(storeId) ?? '',
        phone: '',
        category,
        officialUrl: null,
        portalHost: HOTPEPPER_HOST,
        portalUrl: detailUrl,
      })
    } catch {
      // malformed links are ignored
    }
  }
  return { businesses: [...businesses.values()], totalPages }
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

function businessNameVariants(name: string): string[] {
  const base = name.normalize('NFKC')
  const variants = [
    base,
    base.replace(/【[^】]*】|\[[^\]]*\]|［[^］]*］|（[^）]*）|\([^)]*\)/gu, ' '),
    base.replace(/(?:渋谷|原宿|表参道|恵比寿|代官山|新宿|池袋|銀座|青山|東京|大阪)(?:駅|店|本店|支店)?/gu, ' '),
  ]
  return [...new Set(variants.map(coreBusinessName).filter((value) => value.length >= 2))]
}

/** Score search-result evidence before fetching the candidate website. */
export function scoreOfficialSearchResult(
  business: Pick<PortalBusiness, 'name' | 'address' | 'phone' | 'category'>,
  result: { link?: string; title?: string; snippet?: string },
  area: string,
): { score: number; evidence: string[]; strongIdentity: boolean } {
  const link = result.link?.trim() ?? ''
  const host = extractHost(link)
  if (!link || isBlockedHost(host) || isNonOfficialOrganicTitle(result.title ?? '')) {
    return { score: -100, evidence: ['blocked_or_listing'], strongIdentity: false }
  }
  const title = normalizeText(result.title ?? '')
  const combined = normalizeText(`${result.title ?? ''} ${result.snippet ?? ''}`)
  const variants = businessNameVariants(business.name)
  const phone = phoneDigits(business.phone)
  const resultDigits = phoneDigits(`${result.title ?? ''} ${result.snippet ?? ''}`)
  const phoneMatch = phone.length >= 9 && resultDigits.includes(phone.slice(-9))
  const nameMatch = variants.some((variant) => title.includes(variant) || combined.includes(variant))
  const properTokens = properNameTokens(business.name)
  const tokenMatches = properTokens.filter((token) => host.includes(token) || combined.includes(token)).length
  const areaMatch = normalizeText(`${result.title ?? ''} ${result.snippet ?? ''}`).includes(normalizeText(area))
  const addressMatch = business.address
    ? normalizeText(result.snippet ?? '').includes(normalizeText(business.address).slice(0, 10))
    : false
  const categoryTerms = expandIndustryTerms([business.category]).map(normalizeText).filter((term) => term.length >= 2)
  const industryMatch = categoryTerms.some((term) => combined.includes(term))
  const shallow = isShallowSiteUrl(link)
  const evidence: string[] = []
  let score = 0
  if (phoneMatch) { score += 6; evidence.push('search_phone_match') }
  if (nameMatch) { score += 5; evidence.push('search_name_match') }
  if (tokenMatches > 0) { score += Math.min(3, tokenMatches + 1); evidence.push('search_brand_token_match') }
  if (areaMatch) { score += 2; evidence.push('search_area_match') }
  if (addressMatch) { score += 3; evidence.push('search_address_match') }
  if (industryMatch) { score += 1; evidence.push('search_industry_match') }
  if (shallow) { score += 1; evidence.push('shallow_official_url') }
  return { score, evidence, strongIdentity: phoneMatch || nameMatch || tokenMatches >= 1 }
}

function verifyOfficialPage(
  business: PortalBusiness,
  link: string,
  html: string,
  area: string,
): { score: number; evidence: string[] } {
  const text = htmlToText(html).slice(0, 120_000)
  const normalized = normalizeText(`${pageTitle(html)} ${text}`)
  const variants = businessNameVariants(business.name)
  const phone = phoneDigits(business.phone)
  const pageDigits = phoneDigits(text)
  const evidence: string[] = []
  let score = 0
  if (phone.length >= 9 && pageDigits.includes(phone.slice(-9))) {
    score += 6
    evidence.push('page_phone_match')
  }
  if (variants.some((variant) => normalized.includes(variant))) {
    score += 5
    evidence.push('page_name_match')
  }
  if (business.address && normalized.includes(normalizeText(business.address).slice(0, 10))) {
    score += 4
    evidence.push('page_address_match')
  } else if (normalized.includes(normalizeText(area))) {
    score += 2
    evidence.push('page_area_match')
  }
  const industryTerms = expandIndustryTerms([business.category]).map(normalizeText).filter((term) => term.length >= 2)
  if (industryTerms.some((term) => normalized.includes(term))) {
    score += 2
    evidence.push('page_industry_match')
  }
  if (domainMatchesBusinessName(extractHost(link), business.name)) {
    score += 2
    evidence.push('domain_brand_match')
  }
  return { score, evidence }
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
): Promise<{ url: string; score: number; evidence: string[] } | null> {
  // 精度目標.md 公式HPの検索方法: 事業者名＋地区 / 事業者名＋電話番号
  const queries = [
    ...(business.phone ? [`${business.name} ${business.phone}`] : []),
    ...(business.address ? [`${business.name} ${business.address}`] : []),
    `${business.name} ${area} 公式`,
    ...(business.category ? [`${business.name} ${area} ${business.category}`] : []),
    `${business.name} ${area} ホームページ`,
  ]

  for (const query of [...new Set(queries)].slice(0, 5)) {
    const response = await fetchOrganicPage(query, 1, apiKey)
    stats.researchQueriesExecuted++
    if (response.error) continue
    const ranked = (response.organic ?? [])
      .map((result) => ({ result, ...scoreOfficialSearchResult(business, result, area) }))
      .filter((candidate) => candidate.strongIdentity && candidate.score >= 6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
    for (const candidate of ranked) {
      const result = candidate.result
      const link = result.link?.trim() ?? ''
      const host = extractHost(link)
      if (!link || isBlockedHost(host)) continue
      if (NON_LISTING_HOSTS.has(host) || SNS_HOSTS.has(host)) continue
      // 深いURLは未知ポータルの掲載ページの疑いが強い。ドメイン名が事業者の
      // 固有名を含む場合（グループ公式サイト配下の店舗ページ等）のみ許容する。
      if (!isShallowSiteUrl(link)
        && !domainMatchesBusinessName(host, business.name)
        && business.portalHost !== HOTPEPPER_HOST) continue
      const html = await fetchHtml(link, 8_000)
      if (!html) {
        if (candidate.score >= 10) return { url: link, score: candidate.score, evidence: candidate.evidence }
        continue
      }
      const page = verifyOfficialPage(business, link, html, area)
      const evidence = [...new Set([...candidate.evidence, ...page.evidence])]
      const score = candidate.score + page.score
      if (page.score >= 5 && score >= 11) return { url: link, score, evidence }
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
  existingUrls?: Set<string>
  /** False for a continuation pass that should only resolve durable retries. */
  enumerateSources?: boolean
  // ポータル以外の経路（Placesのwebsite無し事業者など）で見つかった事業者。
  // 名寄せ・公式HP再検索・HP未発見バケットのパイプラインに合流させる。
  extraBusinesses?: PortalBusiness[]
}): Promise<{
  candidates: SerperResultItem[]
  hpNotFound: PortalBusiness[]
  resolvedBusinesses: ResolvedPortalBusiness[]
  attemptedBusinesses: PortalBusiness[]
  stats: PortalDiscoveryStats
}> {
  const enumerateSources = params.enumerateSources !== false
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
    hotPepperEnabled: enumerateSources && supportsHotPepper(params.keywords),
    hotPepperListingPagesFetched: 0,
    hotPepperBusinessesEnumerated: 0,
    hotPepperDetailPagesFetched: 0,
    hotPepperDetailFetchFailedCount: 0,
  }

  const listingLimit = readBoundedInt(process.env.SERPER_PORTAL_LISTING_LIMIT, 12, 1, 60)
  const detailLimit = readBoundedInt(process.env.SERPER_PORTAL_DETAIL_LIMIT, 120, 10, 2000)
  const researchLimit = readBoundedInt(process.env.SERPER_PORTAL_RESEARCH_LIMIT, 3000, 0, 5000)
  const researchConcurrency = readBoundedInt(process.env.SERPER_PORTAL_RESEARCH_CONCURRENCY, 10, 1, 20)
  const fetchConcurrency = readBoundedInt(process.env.SERPER_PORTAL_FETCH_CONCURRENCY, 6, 1, 12)
  const hotPepperFetchConcurrency = readBoundedInt(process.env.HOTPEPPER_FETCH_CONCURRENCY, 4, 1, 8)
  const hotPepperDelayMs = readBoundedInt(process.env.HOTPEPPER_REQUEST_DELAY_MS, 250, 0, 5000)
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

  for (const query of enumerateSources ? discoveryQueries : []) {
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

  // Hot Pepper対象業種では、Serperで偶然見つかった数ページだけに頼らず、
  // 市区町村別一覧のPNページを全走査して店舗IDを列挙する。
  const hotPepperSeeds = new Set(
    listingUrls.map(normalizeHotPepperListingUrl).filter((url): url is string => Boolean(url)),
  )
  if (enumerateSources && stats.hotPepperEnabled && hotPepperSeeds.size === 0) {
    const seedQueries = [...new Set(params.keywords)].slice(0, 4).map(
      (keyword) => `site:${HOTPEPPER_HOST} ${params.area} ${keyword}`,
    )
    for (const query of seedQueries) {
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
      for (const result of response.organic ?? []) {
        const seed = normalizeHotPepperListingUrl(result.link ?? '')
        if (seed) hotPepperSeeds.add(seed)
      }
      // 検索結果が店舗詳細しか返さない場合は、パンくず内の市区町村一覧URLを使う。
      if (hotPepperSeeds.size === 0) {
        const hotPepperDetails = (response.organic ?? [])
          .map((result) => result.link ?? '')
          .filter((link) => extractHost(link) === HOTPEPPER_HOST)
          .slice(0, 2)
        for (const detailUrl of hotPepperDetails) {
          const html = await fetchHtml(detailUrl, fetchTimeoutMs)
          if (!html) continue
          for (const seed of hotPepperListingUrlsInHtml(html)) hotPepperSeeds.add(seed)
          if (hotPepperSeeds.size > 0) break
        }
      }
      if (hotPepperSeeds.size > 0) break
    }
  }

  const hotPepperPageLimit = readBoundedInt(process.env.HOTPEPPER_MAX_PAGES, 150, 1, 500)
  const hotPepperDetailLimit = readBoundedInt(process.env.HOTPEPPER_DETAIL_LIMIT, 2000, 0, 5000)
  const hotPepperSummaries = new Map<string, PortalBusiness>()
  let hotPepperCookie = ''
  for (const seed of enumerateSources ? hotPepperSeeds : []) {
    if (!hasTime()) {
      outOfTime()
      break
    }
    const firstResponse = await fetchHtmlResponse(seed, fetchTimeoutMs, hotPepperCookie)
    const firstHtml = firstResponse.html
    hotPepperCookie = firstResponse.cookie || hotPepperCookie
    stats.listingPagesFetched++
    stats.hotPepperListingPagesFetched++
    if (!firstHtml) {
      stats.fetchFailedCount++
      continue
    }
    const first = extractHotPepperListingPage(firstHtml, seed, params.keywords[0] ?? '')
    for (const business of first.businesses) hotPepperSummaries.set(business.portalUrl, business)
    const totalPages = Math.min(first.totalPages, hotPepperPageLimit)
    const pageUrls = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => hotPepperPageUrl(seed, index + 2))
    for (let offset = 0; offset < pageUrls.length; offset += hotPepperFetchConcurrency) {
      if (!hasTime(180_000)) {
        outOfTime()
        break
      }
      const batch = pageUrls.slice(offset, offset + hotPepperFetchConcurrency)
      const pages = await mapWithConcurrency(batch, hotPepperFetchConcurrency, async (url) => ({
        url,
        html: await fetchHtml(url, fetchTimeoutMs, hotPepperCookie),
      }))
      for (const { url, html } of pages) {
        stats.listingPagesFetched++
        stats.hotPepperListingPagesFetched++
        if (!html) {
          stats.fetchFailedCount++
          continue
        }
        const page = extractHotPepperListingPage(html, url, params.keywords[0] ?? '')
        for (const business of page.businesses) hotPepperSummaries.set(business.portalUrl, business)
      }
      if (hotPepperDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, hotPepperDelayMs))
    }
  }
  stats.hotPepperBusinessesEnumerated = hotPepperSummaries.size

  // 一覧で全店舗を確保した後、可能な範囲で詳細ページから住所・電話番号を補完する。
  // 時間不足でも店舗名とHot Pepper店舗URLは未発見候補として失わない。
  const hotPepperDetails = [...hotPepperSummaries.values()].slice(0, hotPepperDetailLimit)
  for (let offset = 0; offset < hotPepperDetails.length; offset += hotPepperFetchConcurrency) {
    // 公式HPの再検索が本来の目的なので、詳細補完より十分な時間を残す。
    if (!hasTime(180_000)) {
      outOfTime()
      break
    }
    const batch = hotPepperDetails.slice(offset, offset + hotPepperFetchConcurrency)
    const pages = await mapWithConcurrency(batch, hotPepperFetchConcurrency, async (business) => ({
      business,
      html: await fetchHtml(business.portalUrl, fetchTimeoutMs, hotPepperCookie),
    }))
    for (const { business, html } of pages) {
      stats.hotPepperDetailPagesFetched++
      if (!html) {
        stats.hotPepperDetailFetchFailedCount++
        continue
      }
      const detail = extractBusinessesFromHtml(html, business.portalUrl)[0]
      if (!detail) continue
      hotPepperSummaries.set(business.portalUrl, {
        ...business,
        name: detail.name || business.name,
        address: detail.address || business.address,
        phone: detail.phone || business.phone,
        officialUrl: detail.officialUrl ?? business.officialUrl,
      })
    }
    if (hotPepperDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, hotPepperDelayMs))
  }
  extracted.push(...hotPepperSummaries.values())

  const listingQueue = listingUrls.filter((url) => !normalizeHotPepperListingUrl(url))
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
  // Retry work is ordered first so a deadline never starves durable pending
  // businesses behind freshly enumerated portal rows.
  extracted.unshift(...(params.extraBusinesses ?? []))

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
  const resolvedBusinesses: ResolvedPortalBusiness[] = []
  const attemptedBusinesses: PortalBusiness[] = []
  const hpNotFound: PortalBusiness[] = []
  const seenOfficialUrls = new Set(
    [...(params.existingUrls ?? [])].map(normalizeCandidateUrl).filter(Boolean),
  )
  const needResearch: PortalBusiness[] = []

  const pushCandidate = (
    business: PortalBusiness,
    officialUrl: string,
    resolutionScore = 20,
    resolutionEvidence: string[] = ['portal_official_link'],
  ) => {
    const host = extractHost(officialUrl)
    const normalizedOfficialUrl = normalizeCandidateUrl(officialUrl)
    if (isBlockedHost(host) || !normalizedOfficialUrl || seenOfficialUrls.has(normalizedOfficialUrl)) return false
    // 店舗単位で数える業種では、同じチェーンの別店舗ページを同一ドメイン
    // という理由だけで潰さない。完全に同じ公式URLだけを重複除外する。
    seenOfficialUrls.add(normalizedOfficialUrl)
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
    resolvedBusinesses.push({
      ...business,
      officialUrl,
      resolutionScore,
      resolutionEvidence,
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
    const batch = needResearch.slice(processedCount, processedCount + researchConcurrency)
    attemptedBusinesses.push(...batch)
    const found = await mapWithConcurrency(batch, researchConcurrency, async (business) => ({
      business,
      resolution: await researchOfficialUrl(business, params.area, params.apiKey, stats),
    }))
    processedCount += batch.length
    for (const { business, resolution } of found) {
      if (resolution && pushCandidate(business, resolution.url, resolution.score, resolution.evidence)) {
        stats.officialFoundByResearch++
      } else {
        hpNotFound.push(business)
      }
    }
  }
  // 予算・時間切れで再検索できなかった分も「公式HP未発見」に含める
  hpNotFound.push(...needResearch.slice(processedCount))

  stats.hpNotFoundCount = hpNotFound.length
  return { candidates, hpNotFound, resolvedBusinesses, attemptedBusinesses, stats }
}
