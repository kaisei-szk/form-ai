import { expandIndustryTerms } from './industry-synonyms.ts'

export type SerperResultItem = {
  link: string
  title: string
  snippet: string
  keyword: string
  area: string
  source: 'places' | 'organic' | 'portal'
  address: string
  phone: string
  category: string
  placeId: string
}

// Placesに掲載があるが公式サイトURLを持たない事業者。ポータル発見の
// 再検索パイプラインで公式HPを探し、見つからなければ「公式HP未発見」枠へ。
export type NoWebsitePlace = {
  name: string
  address: string
  phone: string
  category: string
  placeId: string
}

export interface SerperSearchStats {
  queriesExecuted: number
  failedQueries: number
  organicQueriesExecuted: number
  organicFailedQueries: number
  rawCandidateCount: number
  organicRawCandidateCount: number
  organicRejectedCount: number
  uniquePlaceCount: number
  noWebsiteCount: number
  areaRejectedCount: number
  blockedDomainCount: number
  duplicateCount: number
  paginationRepeatCount: number
  candidateCount: number
  placesCandidateCount: number
  organicCandidateCount: number
  organicExhaustedQueryCount: number
  organicPageCapReachedQueryCount: number
  organicMaxPages: number
  searchTimeBudgetReached: boolean
  searchElapsedMs: number
  exhaustedQueryCount: number
  pageCapReachedQueryCount: number
  maxPages: number
  keywordsUsed: string[]
  normalizedArea: string
}

// ポータル・SNS・アグリゲータドメイン — 公式HP候補からは除外する。
// ただしポータルは portal-discovery で「候補発見元」として別途活用する。
export const SKIP_DOMAINS = new Set([
  'jalan.net','tabelog.com','hotpepper.jp','ekiten.jp','townpage.ntt.co.jp',
  'navitime.co.jp','navitime.jp','mapion.co.jp','its-mo.com',
  'yelp.com','yelp.co.jp','retty.me','gurunavi.com','gnavi.co.jp',
  'google.com','google.co.jp','facebook.com','instagram.com','twitter.com','x.com',
  'youtube.com','wikipedia.org','linkedin.com','tiktok.com','ameblo.jp','note.com',
  'lit.link','linktr.ee',
  'recruit.co.jp','indeed.com','wantedly.com','yahoo.co.jp',
  'rakuten.co.jp','amazon.co.jp',
  'beauty.hotpepper.jp','minimo.io','hairbook.jp','riyou.jp',
  'beauty-navi.com','ozmall.co.jp','epark.jp','homemate-research.com','zehitomo.com','baseconnect.in',
  'itp.ne.jp','job-medley.com','en-gage.net','doda.jp','openwork.jp',
  'coubic.com','reserva.be','airrsv.net','b-merit.jp','select-type.com',
  'prtimes.jp','imitsu.jp','initial.inc','buffett-code.com','compalyze.co.jp',
  'ipros.com','bizreach.jp','talentsquare.co.jp','hrsquare.jp','batonz.jp',
  'ma-search.com','jma-a.org','map.yahoo.co.jp','mapfan.com','loco.yahoo.co.jp',
  'chosakun.com','nikkeibp.co.jp','fudousan.or.jp',
  'bestsalonreport.jp','beauty-park.jp','minimodel.jp','cuts.jp',
  'hairsalon-map.com','9483.jp','kotomise.jp','repicolle.jp','pathee.com',
  'hair-land.jp','e-shops.jp','athome.co.jp','bizloop.jp','tgnr.jp',
  'yayoi-kk.co.jp','mid-tenshoku.com','inshokuten.com','kokoshiro.jp',
  'tdb-publish.com','my.site.com','next-sfa.jp','ma-pro.com','ma-succeed.jp',
  'maa-a.or.jp','ma-shoukei.com','tranbi.com','ma-japan.info',
  'biz-maps.com','careercross.com',
  'value-press.com','careerticket.jp','in-fra.jp','rocketreach.co','houjin.jp',
  // Comparison/listing media are useful discovery sources, but must never be
  // emitted as an official company website.
  'web-kanji.com','boxil.jp','imitsu.jp','comparison.biz','biz.ne.jp',
  'creators-station.jp','it-trend.jp','solution-store.honichi.com','hokihosting.com',
])

export function extractHost(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/)
  return m ? m[1].replace(/^www\./, '').toLowerCase() : ''
}

export function isNonProductionHost(host: string): boolean {
  return /^(?:test\d*|stg|staging|dev|demo|preview)$/u.test(host.split('.')[0] ?? '')
}

export function normalizeCandidateUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const removable = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']
    removable.forEach((key) => parsed.searchParams.delete(key))
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    return parsed.toString()
  } catch {
    return ''
  }
}

/** Titles that describe a comparison/list article rather than one business. */
export function isNonOfficialOrganicTitle(title: string): boolean {
  return /(?:一覧|ランキング|おすすめ|比較|口コミ|まとめ|検索|予約|求人|採用|転職|会社データ|企業データ|業者を探す|厳選|\d+\s*(?:社|店|選|件)|best\s+\d+|top\s+\d+)/iu.test(title)
}

function normalizeAreaName(rawArea: string): string {
  const area = rawArea.normalize('NFKC').trim()
  const prefectures = [
    '北海道', '東京都', '京都府', '大阪府',
    '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
    '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県',
    '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
    '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
  ]
  return prefectures.find((prefecture) => prefecture.replace(/[都道府県]$/u, '') === area) ?? area
}

function normalizeForMatch(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\u3000]/g, '')
}

function isAddressInRequestedArea(address: string, rawArea: string): boolean {
  const area = normalizeForMatch(normalizeAreaName(rawArea))
  return Boolean(area && address && normalizeForMatch(address).includes(area))
}

function readBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

type SerperPlace = {
  title?: string
  address?: string
  website?: string
  phoneNumber?: string
  description?: string
  type?: string
  types?: string[]
  category?: string
  placeId?: string
  cid?: string
}

type QueryPageResult = {
  places?: SerperPlace[]
  error?: { status: number; text: string }
}

type SerperOrganic = {
  title?: string
  link?: string
  snippet?: string
}

type OrganicPageResult = {
  organic?: SerperOrganic[]
  error?: { status: number; text: string }
}

async function fetchPlacesPage(
  query: string,
  page: number,
  apiKey: string,
): Promise<QueryPageResult> {
  const maxAttempts = 3
  let lastError: { status: number; text: string } | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch('https://google.serper.dev/places', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, gl: 'jp', hl: 'ja', page }),
        signal: AbortSignal.timeout(30_000),
      })

      if (res.ok) {
        const data = await res.json() as { error?: string; places?: SerperPlace[] }
        if (!data.error) return { places: data.places ?? [] }
        lastError = { status: 502, text: data.error }
      } else {
        lastError = { status: res.status, text: await res.text() }
        if (res.status !== 429 && res.status < 500) break
      }
    } catch (error) {
      lastError = { status: 599, text: error instanceof Error ? error.message : String(error) }
    }

    if (attempt + 1 < maxAttempts) {
      const delayMs = Math.min(8_000, 1_000 * (2 ** attempt)) + Math.floor(Math.random() * 250)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return { error: lastError ?? { status: 500, text: 'Unknown Serper error' } }
}

export async function fetchOrganicPage(
  query: string,
  page: number,
  apiKey: string,
): Promise<OrganicPageResult> {
  const maxAttempts = 3
  let lastError: { status: number; text: string } | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, gl: 'jp', hl: 'ja', page }),
        signal: AbortSignal.timeout(30_000),
      })

      if (res.ok) {
        const data = await res.json() as { error?: string; organic?: SerperOrganic[] }
        if (!data.error) return { organic: data.organic ?? [] }
        lastError = { status: 502, text: data.error }
      } else {
        lastError = { status: res.status, text: await res.text() }
        if (res.status !== 429 && res.status < 500) break
      }
    } catch (error) {
      lastError = { status: 599, text: error instanceof Error ? error.message : String(error) }
    }

    if (attempt + 1 < maxAttempts) {
      const delayMs = Math.min(8_000, 1_000 * (2 ** attempt)) + Math.floor(Math.random() * 250)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return { error: lastError ?? { status: 500, text: 'Unknown Serper error' } }
}

export async function runSerperSearch(params: {
  keywords: string[]
  area: string
  maxResults?: number
  maxPages?: number
  includeOrganic?: boolean
  apiKey: string
}): Promise<{
  items: SerperResultItem[]
  noWebsitePlaces: NoWebsitePlace[]
  stats: SerperSearchStats
  error?: { status: number; text: string }
  errors: Array<{ status: number; text: string }>
}> {
  const startedAt = Date.now()
  // Vercel等の300秒制限下ではデフォルト240秒。ローカル/セルフホストでは
  // SERPER_TIME_BUDGET_MS で最長30分まで拡大できる。
  const timeBudgetMs = readBoundedInt(process.env.SERPER_TIME_BUDGET_MS, 240_000, 60_000, 1_800_000)
  const deadline = startedAt + timeBudgetMs
  let searchTimeBudgetReached = false
  // Leave enough room for one worst-case 30-second Serper request batch and
  // response serialization before the platform's 300-second hard timeout.
  const hasTimeForBatch = () => Date.now() < deadline - 35_000
  const normalizedArea = normalizeAreaName(params.area)
  const inputKeywords = [...new Set(params.keywords
    .map((keyword) => keyword.normalize('NFKC').trim())
    .filter((keyword) => keyword && !/\b(?:AND|OR)\b|[|()]/iu.test(keyword))
  )]
  // 業種同義語（美容室↔美容院など）を検索語にも展開して候補母数を広げる。
  // 入力キーワードを先頭に保ち、同義語は後ろへ追加する。
  const synonymKeywords = expandIndustryTerms(inputKeywords)
    .filter((keyword) => !inputKeywords.includes(keyword))
  const keywords = [...inputKeywords, ...synonymKeywords].slice(0, 30)
  const resultLimit = params.maxResults && params.maxResults > 0 ? params.maxResults : Number.POSITIVE_INFINITY
  // A finite cap protects API credits, while still allowing operators to raise
  // the depth without changing code when a broad category has not saturated.
  const maxPages = params.maxPages ?? readBoundedInt(process.env.SERPER_MAX_PAGES, 50, 1, 50)
  const concurrency = readBoundedInt(process.env.SERPER_CONCURRENCY, 5, 1, 10)
  const seenPlaces = new Set<string>()
  const seenPlacesByKeyword = new Map<string, Set<string>>()
  const seenUrls = new Set<string>()
  const exhaustedQueries = new Set<string>()
  const zeroNewPages = new Map<string, number>()
  const items: SerperResultItem[] = []
  const noWebsitePlaces: NoWebsitePlace[] = []
  const errors: Array<{ status: number; text: string }> = []

  const stats: SerperSearchStats = {
    queriesExecuted: 0,
    failedQueries: 0,
    organicQueriesExecuted: 0,
    organicFailedQueries: 0,
    rawCandidateCount: 0,
    organicRawCandidateCount: 0,
    organicRejectedCount: 0,
    uniquePlaceCount: 0,
    noWebsiteCount: 0,
    areaRejectedCount: 0,
    blockedDomainCount: 0,
    duplicateCount: 0,
    paginationRepeatCount: 0,
    candidateCount: 0,
    placesCandidateCount: 0,
    organicCandidateCount: 0,
    organicExhaustedQueryCount: 0,
    organicPageCapReachedQueryCount: 0,
    organicMaxPages: 0,
    searchTimeBudgetReached: false,
    searchElapsedMs: 0,
    exhaustedQueryCount: 0,
    pageCapReachedQueryCount: 0,
    maxPages,
    keywordsUsed: keywords,
    normalizedArea,
  }

  // Page-major ordering spreads requests across every independent retrieval
  // term before going deeper into any one result set. No AND/OR query syntax or
  // contact-form suffix is used.
  placesLoop: for (let page = 1; page <= maxPages && items.length < resultLimit; page++) {
    const activeKeywords = keywords.filter((keyword) => !exhaustedQueries.has(keyword))
    if (activeKeywords.length === 0) break

    for (let offset = 0; offset < activeKeywords.length && items.length < resultLimit; offset += concurrency) {
      if (!hasTimeForBatch()) {
        searchTimeBudgetReached = true
        break placesLoop
      }
      const batch = activeKeywords.slice(offset, offset + concurrency)
      const responses = await Promise.all(batch.map(async (keyword) => ({
        keyword,
        response: await fetchPlacesPage(`${keyword} ${normalizedArea}`, page, params.apiKey),
      })))
      stats.queriesExecuted += batch.length

      for (const { keyword, response } of responses) {
        if (response.error) {
          stats.failedQueries++
          errors.push(response.error)
          continue
        }

        const places = response.places ?? []
        let newPlacesOnPage = 0
        stats.rawCandidateCount += places.length
        const keywordSeen = seenPlacesByKeyword.get(keyword) ?? new Set<string>()
        seenPlacesByKeyword.set(keyword, keywordSeen)

        for (const place of places) {
          const placeKey = place.placeId || place.cid || `${place.title ?? ''}|${place.address ?? ''}`
          if (!placeKey) {
            stats.duplicateCount++
            continue
          }

          // Saturation is per query. A place found earlier through another
          // synonym must still count as new for this keyword, otherwise later
          // keywords are incorrectly stopped after two pages.
          if (keywordSeen.has(placeKey)) {
            stats.paginationRepeatCount++
            continue
          }
          keywordSeen.add(placeKey)
          newPlacesOnPage++

          // Final output remains globally deduplicated across all synonyms.
          if (seenPlaces.has(placeKey)) {
            stats.duplicateCount++
            continue
          }
          seenPlaces.add(placeKey)
          stats.uniquePlaceCount++

          const link = place.website?.trim() ?? ''
          if (!link) {
            stats.noWebsiteCount++
            if ((place.title ?? '').trim() && isAddressInRequestedArea(place.address ?? '', normalizedArea)) {
              noWebsitePlaces.push({
                name: (place.title ?? '').trim(),
                address: place.address ?? '',
                phone: place.phoneNumber ?? '',
                category: [...new Set([place.type, place.category, ...(place.types ?? [])].filter(Boolean))].join(' / '),
                placeId: place.placeId ?? place.cid ?? placeKey,
              })
            }
            continue
          }
          if (!isAddressInRequestedArea(place.address ?? '', normalizedArea)) {
            stats.areaRejectedCount++
            continue
          }

          const host = extractHost(link)
          if (!host || isNonProductionHost(host) || SKIP_DOMAINS.has(host) || [...SKIP_DOMAINS].some((domain) => host.endsWith(`.${domain}`))) {
            stats.blockedDomainCount++
            continue
          }

          const normalizedUrl = normalizeCandidateUrl(link)
          if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
            stats.duplicateCount++
            continue
          }
          seenUrls.add(normalizedUrl)
          items.push({
            link,
            title: place.title ?? '',
            snippet: place.description ?? '',
            keyword,
            area: normalizedArea,
            source: 'places',
            address: place.address ?? '',
            phone: place.phoneNumber ?? '',
            category: [...new Set([place.type, place.category, ...(place.types ?? [])].filter(Boolean))].join(' / '),
            placeId: place.placeId ?? place.cid ?? placeKey,
          })
          if (items.length >= resultLimit) break
        }

        // Relevance filtering must not make pagination stop early. Saturation is
        // based on unseen places returned by Serper, not accepted candidates.
        const consecutiveEmpty = newPlacesOnPage === 0 ? (zeroNewPages.get(keyword) ?? 0) + 1 : 0
        zeroNewPages.set(keyword, consecutiveEmpty)
        // A single empty page can be transient. Stop only after two consecutive
        // pages with no unseen places for this exact keyword.
        if (consecutiveEmpty >= 2) exhaustedQueries.add(keyword)
      }

      if (items.length < resultLimit) {
        await new Promise((resolve) => setTimeout(resolve, 1_100))
      }
    }
  }

  stats.candidateCount = items.length
  stats.exhaustedQueryCount = exhaustedQueries.size
  stats.pageCapReachedQueryCount = keywords.filter((keyword) => !exhaustedQueries.has(keyword)).length
  stats.placesCandidateCount = items.length

  // Serper's regular web results can recover official sites that are absent
  // from a Places listing. They remain only discovery candidates: the later
  // relevance gate requires on-site address and industry evidence before an
  // organic result is admitted.
  if (params.includeOrganic !== false && items.length < resultLimit) {
    const organicMaxPages = readBoundedInt(process.env.SERPER_ORGANIC_MAX_PAGES, 20, 1, 20)
    const organicQueryLimit = readBoundedInt(process.env.SERPER_ORGANIC_QUERY_LIMIT, 30, 1, 60)
    // These are independent plain queries, not AND/OR syntax. The variants
    // diversify Serper's ranking without changing or subdividing the area.
    const organicVariants = ['公式', '会社概要', '']
    const organicQueries = organicVariants
      .flatMap((variant) => keywords.map((keyword) => ({
        key: `${keyword}\u0000${variant || 'plain'}`,
        keyword,
        query: [keyword, normalizedArea, variant].filter(Boolean).join(' '),
      })))
      .slice(0, organicQueryLimit)
    const organicExhausted = new Set<string>()
    const organicZeroNewPages = new Map<string, number>()
    const organicSeenByKeyword = new Map<string, Set<string>>()
    const seenOrganicHosts = new Set(items.map((item) => extractHost(item.link)).filter(Boolean))
    stats.organicMaxPages = organicMaxPages

    organicLoop: for (let page = 1; page <= organicMaxPages && items.length < resultLimit; page++) {
      const activeQueries = organicQueries.filter((query) => !organicExhausted.has(query.key))
      if (activeQueries.length === 0) break

      for (let offset = 0; offset < activeQueries.length && items.length < resultLimit; offset += concurrency) {
        if (!hasTimeForBatch()) {
          searchTimeBudgetReached = true
          break organicLoop
        }
        const batch = activeQueries.slice(offset, offset + concurrency)
        const responses = await Promise.all(batch.map(async (query) => ({
          query,
          response: await fetchOrganicPage(query.query, page, params.apiKey),
        })))
        stats.queriesExecuted += batch.length
        stats.organicQueriesExecuted += batch.length

        for (const { query, response } of responses) {
          if (response.error) {
            stats.failedQueries++
            stats.organicFailedQueries++
            errors.push(response.error)
            continue
          }

          const organic = response.organic ?? []
          stats.rawCandidateCount += organic.length
          stats.organicRawCandidateCount += organic.length
          let newResultsOnPage = 0
          const keywordSeen = organicSeenByKeyword.get(query.key) ?? new Set<string>()
          organicSeenByKeyword.set(query.key, keywordSeen)

          for (const result of organic) {
            const normalizedUrl = normalizeCandidateUrl(result.link?.trim() ?? '')
            if (!normalizedUrl) {
              stats.organicRejectedCount++
              continue
            }
            if (keywordSeen.has(normalizedUrl)) {
              stats.paginationRepeatCount++
              continue
            }
            keywordSeen.add(normalizedUrl)
            newResultsOnPage++

            const host = extractHost(normalizedUrl)
            const blockedHost = !host || isNonProductionHost(host) || SKIP_DOMAINS.has(host)
              || [...SKIP_DOMAINS].some((domain) => host.endsWith(`.${domain}`))
            if (blockedHost || isNonOfficialOrganicTitle(result.title ?? '')) {
              stats.organicRejectedCount++
              continue
            }
            if (seenUrls.has(normalizedUrl)) {
              stats.duplicateCount++
              continue
            }
            if (seenOrganicHosts.has(host)) {
              stats.duplicateCount++
              continue
            }

            seenUrls.add(normalizedUrl)
            seenOrganicHosts.add(host)
            items.push({
              link: result.link ?? normalizedUrl,
              title: result.title ?? '',
              snippet: result.snippet ?? '',
              keyword: query.keyword,
              area: normalizedArea,
              source: 'organic',
              address: '',
              phone: '',
              category: '',
              placeId: `organic:${normalizedUrl}`,
            })
            if (items.length >= resultLimit) break
          }

          const consecutiveEmpty = newResultsOnPage === 0
            ? (organicZeroNewPages.get(query.key) ?? 0) + 1
            : 0
          organicZeroNewPages.set(query.key, consecutiveEmpty)
          if (consecutiveEmpty >= 2) organicExhausted.add(query.key)
        }

        if (items.length < resultLimit) {
          await new Promise((resolve) => setTimeout(resolve, 1_100))
        }
      }
    }
    stats.organicExhaustedQueryCount = organicExhausted.size
    stats.organicPageCapReachedQueryCount = organicQueries
      .filter((query) => !organicExhausted.has(query.key)).length
  }

  const error = errors.length > 0 ? errors[0] : undefined
  stats.candidateCount = items.length
  stats.organicCandidateCount = Math.max(0, items.length - stats.placesCandidateCount)
  stats.searchTimeBudgetReached = searchTimeBudgetReached
  stats.searchElapsedMs = Date.now() - startedAt
  return { items, noWebsitePlaces, stats, errors: errors.slice(0, 100), ...(error && { error }) }
}
