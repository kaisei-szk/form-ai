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

export type SerperSearchPhase = 'places' | 'organic' | 'complete'

export interface SerperSearchProgress {
  phase: SerperSearchPhase
  nextPage: number
  maxPages: number
  candidateCount: number
  rawCandidateCount: number
  queriesExecuted: number
  exhaustedQueryCount: number
  searchElapsedMs: number
  resumeAvailable: boolean
  updatedAt: string
}

export interface SerperSearchCheckpoint {
  version: 1
  signature: string
  phase: SerperSearchPhase
  nextPage: number
  items: SerperResultItem[]
  noWebsitePlaces: NoWebsitePlace[]
  seenPlaces: string[]
  seenPlacesByKeyword: Array<[string, string[]]>
  seenUrls: string[]
  exhaustedQueries: string[]
  zeroNewPages: Array<[string, number]>
  organicExhausted: string[]
  organicZeroNewPages: Array<[string, number]>
  organicSeenByKeyword: Array<[string, string[]]>
  seenOrganicHosts: string[]
  stats: SerperSearchStats
  errors: Array<{ status: number; text: string }>
  updatedAt: string
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
  requestDelayMs?: number
  timeBudgetMs?: number
  checkpoint?: SerperSearchCheckpoint
  onProgress?: (
    progress: SerperSearchProgress,
    checkpoint?: SerperSearchCheckpoint,
  ) => Promise<void> | void
  apiKey: string
}): Promise<{
  items: SerperResultItem[]
  noWebsitePlaces: NoWebsitePlace[]
  stats: SerperSearchStats
  error?: { status: number; text: string }
  errors: Array<{ status: number; text: string }>
}> {
  const startedAt = Date.now()
  const timeBudgetMs = params.timeBudgetMs
    ?? readBoundedInt(process.env.SERPER_TIME_BUDGET_MS, 240_000, 60_000, 1_800_000)
  const deadline = startedAt + timeBudgetMs
  const deadlineMarginMs = params.timeBudgetMs === undefined ? 35_000 : 0
  let searchTimeBudgetReached = false
  const hasTimeForBatch = () => Date.now() < deadline - deadlineMarginMs
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
  const maxPages = params.maxPages ?? readBoundedInt(process.env.SERPER_MAX_PAGES, 50, 1, 50)
  const concurrency = readBoundedInt(process.env.SERPER_CONCURRENCY, 5, 1, 10)
  const requestDelayMs = params.requestDelayMs
    ?? readBoundedInt(process.env.REQUEST_DELAY_MS, 1_100, 0, 10_000)
  const organicMaxPages = readBoundedInt(process.env.SERPER_ORGANIC_MAX_PAGES, 20, 1, 20)
  const organicQueryLimit = readBoundedInt(process.env.SERPER_ORGANIC_QUERY_LIMIT, 30, 1, 60)
  const signature = JSON.stringify({
    normalizedArea,
    keywords,
    maxPages,
    organicMaxPages,
    organicQueryLimit,
    includeOrganic: params.includeOrganic !== false,
    maxResults: params.maxResults ?? 0,
  })
  const resume = params.checkpoint?.version === 1 && params.checkpoint.signature === signature
    ? params.checkpoint
    : undefined
  const freshStats: SerperSearchStats = {
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
  const stats: SerperSearchStats = resume ? { ...freshStats, ...resume.stats } : freshStats
  const priorElapsedMs = resume?.stats.searchElapsedMs ?? 0
  stats.searchTimeBudgetReached = false
  const items = [...(resume?.items ?? [])]
  const noWebsitePlaces = [...(resume?.noWebsitePlaces ?? [])]
  const seenPlaces = new Set(resume?.seenPlaces ?? [])
  const seenPlacesByKeyword = new Map((resume?.seenPlacesByKeyword ?? []).map(([key, values]) => [key, new Set(values)]))
  const seenUrls = new Set(resume?.seenUrls ?? [])
  const exhaustedQueries = new Set(resume?.exhaustedQueries ?? [])
  const zeroNewPages = new Map(resume?.zeroNewPages ?? [])
  const errors = [...(resume?.errors ?? [])]
  const organicVariants = ['公式', '会社概要', '']
  const organicQueries = organicVariants
    .flatMap((variant) => keywords.map((keyword) => ({
      // PostgreSQL jsonb cannot store U+0000. This key is persisted inside
      // search checkpoints, so use a collision-safe JSON tuple instead of a
      // NUL-delimited string.
      key: JSON.stringify([keyword, variant || 'plain']),
      keyword,
      query: [keyword, normalizedArea, variant].filter(Boolean).join(' '),
    })))
    .slice(0, organicQueryLimit)
  const organicExhausted = new Set(resume?.organicExhausted ?? [])
  const organicZeroNewPages = new Map(resume?.organicZeroNewPages ?? [])
  const organicSeenByKeyword = new Map((resume?.organicSeenByKeyword ?? []).map(([key, values]) => [key, new Set(values)]))
  const seenOrganicHosts = new Set(resume?.seenOrganicHosts ?? items.map((item) => extractHost(item.link)).filter(Boolean))
  let phase: SerperSearchPhase = resume?.phase ?? 'places'
  let nextPage = resume?.nextPage ?? 1
  let resumeAvailable = Boolean(resume && resume.phase !== 'complete')

  const refreshStats = () => {
    stats.candidateCount = items.length
    stats.exhaustedQueryCount = exhaustedQueries.size
    stats.pageCapReachedQueryCount = keywords.filter((keyword) => !exhaustedQueries.has(keyword)).length
    stats.organicExhaustedQueryCount = organicExhausted.size
    stats.organicPageCapReachedQueryCount = organicQueries.filter((query) => !organicExhausted.has(query.key)).length
    stats.searchElapsedMs = priorElapsedMs + Date.now() - startedAt
  }
  const makeCheckpoint = (checkpointPhase: SerperSearchPhase, checkpointNextPage: number): SerperSearchCheckpoint => {
    refreshStats()
    return {
      version: 1,
      signature,
      phase: checkpointPhase,
      nextPage: checkpointNextPage,
      items: [...items],
      noWebsitePlaces: [...noWebsitePlaces],
      seenPlaces: [...seenPlaces],
      seenPlacesByKeyword: [...seenPlacesByKeyword].map(([key, values]) => [key, [...values]]),
      seenUrls: [...seenUrls],
      exhaustedQueries: [...exhaustedQueries],
      zeroNewPages: [...zeroNewPages],
      organicExhausted: [...organicExhausted],
      organicZeroNewPages: [...organicZeroNewPages],
      organicSeenByKeyword: [...organicSeenByKeyword].map(([key, values]) => [key, [...values]]),
      seenOrganicHosts: [...seenOrganicHosts],
      stats: { ...stats },
      errors: [...errors],
      updatedAt: new Date().toISOString(),
    }
  }
  const publishProgress = async (checkpoint?: SerperSearchCheckpoint) => {
    if (checkpoint) resumeAvailable = checkpoint.phase !== 'complete'
    refreshStats()
    const phaseMaxPages = phase === 'places' ? maxPages : phase === 'organic' ? organicMaxPages : 0
    await params.onProgress?.({
      phase,
      nextPage,
      maxPages: phaseMaxPages,
      candidateCount: items.length,
      rawCandidateCount: stats.rawCandidateCount,
      queriesExecuted: stats.queriesExecuted,
      exhaustedQueryCount: phase === 'places' ? exhaustedQueries.size : organicExhausted.size,
      searchElapsedMs: stats.searchElapsedMs,
      resumeAvailable,
      updatedAt: new Date().toISOString(),
    }, checkpoint)
  }

  if (phase === 'places') {
    let placesCompleted = true
    placesLoop: for (let page = nextPage; page <= maxPages && items.length < resultLimit; page++) {
      const activeKeywords = keywords.filter((keyword) => !exhaustedQueries.has(keyword))
      if (activeKeywords.length === 0) break
      for (let offset = 0; offset < activeKeywords.length && items.length < resultLimit; offset += concurrency) {
        if (!hasTimeForBatch()) {
          searchTimeBudgetReached = true
          placesCompleted = false
          nextPage = page
          await publishProgress()
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
            if (keywordSeen.has(placeKey)) {
              stats.paginationRepeatCount++
              continue
            }
            keywordSeen.add(placeKey)
            newPlacesOnPage++
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
          const consecutiveEmpty = newPlacesOnPage === 0 ? (zeroNewPages.get(keyword) ?? 0) + 1 : 0
          zeroNewPages.set(keyword, consecutiveEmpty)
          if (consecutiveEmpty >= 2) exhaustedQueries.add(keyword)
        }
        nextPage = page
        await publishProgress()
        if (items.length < resultLimit && requestDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, requestDelayMs))
        }
      }
      nextPage = page + 1
      await publishProgress(makeCheckpoint('places', nextPage))
    }
    stats.placesCandidateCount = items.length
    if (placesCompleted) {
      phase = params.includeOrganic === false || items.length >= resultLimit ? 'complete' : 'organic'
      nextPage = 1
      await publishProgress(makeCheckpoint(phase, nextPage))
    }
  }

  if (phase === 'organic' && !searchTimeBudgetReached && items.length < resultLimit) {
    stats.organicMaxPages = organicMaxPages
    let organicCompleted = true
    organicLoop: for (let page = nextPage; page <= organicMaxPages && items.length < resultLimit; page++) {
      const activeQueries = organicQueries.filter((query) => !organicExhausted.has(query.key))
      if (activeQueries.length === 0) break
      for (let offset = 0; offset < activeQueries.length && items.length < resultLimit; offset += concurrency) {
        if (!hasTimeForBatch()) {
          searchTimeBudgetReached = true
          organicCompleted = false
          nextPage = page
          await publishProgress()
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
          let newCandidateHostsOnPage = 0
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
            const host = extractHost(normalizedUrl)
            const blockedHost = !host || isNonProductionHost(host) || SKIP_DOMAINS.has(host)
              || [...SKIP_DOMAINS].some((domain) => host.endsWith(`.${domain}`))
            if (blockedHost || isNonOfficialOrganicTitle(result.title ?? '')) {
              stats.organicRejectedCount++
              continue
            }
            if (seenUrls.has(normalizedUrl) || seenOrganicHosts.has(host)) {
              stats.duplicateCount++
              continue
            }
            seenUrls.add(normalizedUrl)
            seenOrganicHosts.add(host)
            newCandidateHostsOnPage++
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
          const consecutiveEmpty = newCandidateHostsOnPage === 0
            ? (organicZeroNewPages.get(query.key) ?? 0) + 1
            : 0
          organicZeroNewPages.set(query.key, consecutiveEmpty)
          if (consecutiveEmpty >= 2) organicExhausted.add(query.key)
        }
        nextPage = page
        await publishProgress()
        if (items.length < resultLimit && requestDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, requestDelayMs))
        }
      }
      nextPage = page + 1
      await publishProgress(makeCheckpoint('organic', nextPage))
    }
    if (organicCompleted) {
      phase = 'complete'
      nextPage = 0
      await publishProgress(makeCheckpoint('complete', nextPage))
    }
  }

  const error = errors.length > 0 ? errors[0] : undefined
  refreshStats()
  stats.organicCandidateCount = Math.max(0, items.length - stats.placesCandidateCount)
  stats.searchTimeBudgetReached = searchTimeBudgetReached
  return { items, noWebsitePlaces, stats, errors: errors.slice(0, 100), ...(error && { error }) }
}
