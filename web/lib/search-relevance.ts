import { expandIndustryTerms } from './industry-synonyms.ts'

export type CandidateSource = 'places' | 'organic' | 'portal'

export interface CandidateRelevanceInput {
  url: string
  industry: string
  keywords: string[]
  area: string
  searchArea?: string
  source?: CandidateSource
  sourceTitle?: string
  sourceSnippet?: string
  sourceAddress?: string
  sourceCategory?: string
  sourcePhone?: string
  extractedAddress?: string | null
  extractedPhone?: string | null
  homepageTitle?: string | null
  homepageText?: string | null
  hasBusinessSchema?: boolean
  hasDirectorySchema?: boolean
  redirectedToNonOfficial?: boolean
  /** Same-origin pages inspected in addition to the landing page. */
  evidencePageKinds?: Array<'company' | 'service' | 'access'>
}

export type CandidateRejectionReason =
  | 'invalid_url'
  | 'unverified_official_site'
  | 'missing_area_evidence'
  | 'area_mismatch'
  | 'missing_industry_evidence'
  | 'negative_industry_evidence'
  | 'insufficient_evidence'

export type CandidateRelevanceStatus = 'accepted' | 'hold' | 'rejected'

export interface CandidateRelevanceDecision {
  status: CandidateRelevanceStatus
  reasons: CandidateRejectionReason[]
  areaMatched: boolean
  industryMatched: boolean
  officialSite: boolean
  score: number
  evidence: string[]
}

const PREFECTURE_SUFFIX_RE = /[都道府県]$/u

/**
 * Common shorthand such as "大阪" is interpreted as the prefecture when it
 * exactly matches a prefecture name without its suffix. City/ward names are
 * otherwise left untouched.
 */
export function normalizeAreaName(rawArea: string): string {
  const area = rawArea.normalize('NFKC').trim()
  if (!area) return area

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

  return prefectures.find((prefecture) => prefecture.replace(PREFECTURE_SUFFIX_RE, '') === area) ?? area
}

export function validateAreaInput(rawArea: string): {
  valid: boolean
  normalized: string
  reason?: string
} {
  const normalized = normalizeAreaName(rawArea)
  if (!normalized) return { valid: false, normalized, reason: 'エリアを入力してください' }

  // This product intentionally searches by the supplied place name only.
  // Station/radius labels imply a distance search and must never be silently
  // converted into a wider municipality search.
  if (/(?:駅(?:周辺|付近)?|周辺|付近)$/u.test(normalized) || /(?:半径|\d+(?:\.\d+)?\s*(?:km|キロ))/iu.test(normalized)) {
    return {
      valid: false,
      normalized,
      reason: '駅周辺・距離検索は使えません。「渋谷区」のように地名だけを指定してください',
    }
  }

  if (/[,，、・＆&/／]/u.test(normalized)) {
    return {
      valid: false,
      normalized,
      reason: '複数エリアを一つの入力に混ぜず、地名を1件だけ指定してください',
    }
  }

  if (new Set(['中央区', '港区', '北区']).has(normalized)) {
    return {
      valid: false,
      normalized,
      reason: `「${normalized}」は複数の都市にあるため、「東京都${normalized}」「大阪市${normalized}」のように上位地名も指定してください`,
    }
  }

  return { valid: true, normalized }
}

function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000・･,，.。/／\\|｜「」『』【】()（）［］\[\]{}]/g, '')
}

function areaNeedle(rawArea: string): string {
  return normalizeEvidence(normalizeAreaName(rawArea))
}

/** Strict area test used both before and after fetching a candidate HP. */
export function isAddressInArea(address: string, rawArea: string): boolean {
  const needle = areaNeedle(rawArea)
  if (!needle || !address.trim()) return false
  return normalizeEvidence(address).includes(needle)
}

export function isDirectorySchemaTypes(types: string[]): boolean {
  const normalized = types.map((type) => type.toLowerCase())
  return normalized.includes('itemlist') || normalized.includes('searchresultspage')
}

function containsIndustryEvidence(haystack: string, terms: string[]): boolean {
  const normalizedHaystack = normalizeEvidence(haystack)
  if (!normalizedHaystack) return false

  return terms.some((term) => {
    const normalizedTerm = normalizeEvidence(term)
    // One-character terms create too many accidental matches and are not
    // reliable enough for a precision-first admission gate.
    return normalizedTerm.length >= 2 && normalizedHaystack.includes(normalizedTerm)
  })
}

function containsSelfDeclaredIndustryEvidence(haystack: string, terms: string[]): boolean {
  const normalizedHaystack = normalizeEvidence(haystack)
  if (!normalizedHaystack) return false

  return terms.some((term) => {
    const normalizedTerm = normalizeEvidence(term)
    if (normalizedTerm.length < 2) return false
    let from = 0
    while (from < normalizedHaystack.length) {
      const index = normalizedHaystack.indexOf(normalizedTerm, from)
      if (index < 0) return false
      const before = normalizedHaystack.slice(Math.max(0, index - 50), index)
      const after = normalizedHaystack.slice(index + normalizedTerm.length, index + normalizedTerm.length + 40)
      const subjectBefore = /(?:当社|弊社|私たち|わたしたち|当法人|当事務所)(?:は|が|では)?.{0,30}$/u.test(before)
      const declarationAfter = /^(?:会社|企業|事業者|専門会社|専門店|サロン|事業|業務|サービス)?(?:です|である|として|を行|を提供|を展開|を営|に特化|を専門|を支援|をサポート)/u.test(after)
      const structuredServiceAfter = /^(?:事業|業務|サービス|支援|サポート|専門会社|専門店|サロン)/u.test(after)
      const structuredLabelBefore = /(?:事業内容|業務内容|提供サービス|主なサービス|サービス内容|営業内容|取扱業務).{0,30}$/u.test(before)
      if (subjectBefore || declarationAfter || structuredServiceAfter || structuredLabelBefore) return true
      from = index + normalizedTerm.length
    }
    return false
  })
}

function containsNegativeIndustryEvidence(haystack: string, terms: string[]): boolean {
  const normalizedHaystack = normalizeEvidence(haystack)
    // Japanese sites commonly write acronym-led compounds with an optional
    // particle ("M&Aの仲介"). Remove that particle only for negative matching.
    .replace(/([a-z0-9&]+)の(?=[一-龠々〆ヵヶぁ-んァ-ヶー])/giu, '$1')
  if (!normalizedHaystack) return false

  return terms.some((term) => {
    const normalizedTerm = normalizeEvidence(term)
    if (normalizedTerm.length < 2) return false
    let from = 0
    while (from < normalizedHaystack.length) {
      const index = normalizedHaystack.indexOf(normalizedTerm, from)
      if (index < 0) return false
      const before = normalizedHaystack.slice(Math.max(0, index - 220), index)
      const after = normalizedHaystack.slice(index + normalizedTerm.length, index + normalizedTerm.length + 60)
      const candidateOwnStatement = /(?:当社|弊社|私たち|わたしたち|当法人|当事務所)(?:は|では)?.{0,200}$/u.test(before)
      const directNegation = /^(?:事業|業務|サービス)?(?:は|を)?(?:行わない|行っていない|行いません|いたしません|しない|していない|せず|非対応|対象外)/u.test(after)
        || /^(?:ではなく|でなく)/u.test(after)
      if (candidateOwnStatement && directNegation) return true
      from = index + normalizedTerm.length
    }
    return false
  })
}

function isLikelyOfficialCorporatePage(rawUrl: string): boolean {
  try {
    const path = decodeURIComponent(new URL(rawUrl).pathname)
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '')
      .toLowerCase()
    if (!path) return true
    return /^\/(?:company|corporate|about(?:-us)?|profile|outline|business|businesses|service|services|事業内容|業務内容|サービス|会社概要|企業情報)$/u.test(path)
      || /^\/(?:company|corporate)\/(?:outline|overview|profile)$/u.test(path)
  } catch {
    return false
  }
}

function isLikelyNonOfficialContentPage(rawUrl: string): boolean {
  try {
    const path = decodeURIComponent(new URL(rawUrl).pathname).toLowerCase()
    return /\/(?:press(?:release)?|news|posts?|articles?|columns?|blogs?|jobs?|careers?|professional|companies|item|cases?|case-study|works?|portfolio|interviews?)(?:\/|$)/u.test(path)
  } catch {
    return true
  }
}

function isLikelyListingPageTitle(title: string): boolean {
  return /(?:一覧|ランキング|比較|まとめ|厳選|\d+\s*(?:社|店|選|件))/iu.test(title)
}

const NON_OFFICIAL_HOSTS = new Set([
  'prtimes.jp', 'imitsu.jp', 'initial.inc', 'buffett-code.com', 'compalyze.co.jp',
  'ipros.com', 'bizreach.jp', 'talentsquare.co.jp', 'hrsquare.jp', 'batonz.jp',
  'ma-search.com', 'jma-a.org', 'baseconnect.in', 'map.yahoo.co.jp', 'mapfan.com',
  'loco.yahoo.co.jp', 'hotpepper.jp', 'rakuten.co.jp', 'epark.jp', 'ameblo.jp',
  'note.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'chosakun.com', 'nikkeibp.co.jp', 'fudousan.or.jp',
  'bestsalonreport.jp', 'beauty-park.jp', 'minimodel.jp', 'cuts.jp',
  'hairsalon-map.com', '9483.jp', 'kotomise.jp', 'repicolle.jp', 'pathee.com',
  'hair-land.jp', 'e-shops.jp', 'athome.co.jp', 'bizloop.jp', 'tgnr.jp',
  'yayoi-kk.co.jp', 'mid-tenshoku.com', 'inshokuten.com', 'kokoshiro.jp',
  'tdb-publish.com', 'my.site.com', 'next-sfa.jp', 'ma-pro.com', 'ma-succeed.jp',
  'maa-a.or.jp', 'ma-shoukei.com', 'tranbi.com', 'ma-japan.info',
  'biz-maps.com', 'careercross.com',
  'value-press.com', 'careerticket.jp', 'in-fra.jp', 'rocketreach.co', 'houjin.jp',
  'web-kanji.com', 'boxil.jp', 'comparison.biz', 'biz.ne.jp',
  'creators-station.jp', 'it-trend.jp', 'solution-store.honichi.com', 'hokihosting.com',
])

function isKnownNonOfficialUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '')
    const firstLabel = host.split('.')[0]
    return /^(?:test\d*|stg|staging|dev|demo|preview)$/u.test(firstLabel)
      || [...NON_OFFICIAL_HOSTS].some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return true
  }
}

function extractCoreName(title: string): string {
  const firstSegment = title.split(/[|｜/／«»—–【】\[\]]/u)[0] ?? title
  return normalizeEvidence(
    firstSegment.replace(/(?:株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|\(株\)|㈱|\(有\)|㈲)/gu, ''),
  )
}

function namesMatch(sourceTitle: string | undefined, homepageTitle: string | null | undefined): boolean {
  if (!sourceTitle || !homepageTitle) return false
  const core = extractCoreName(sourceTitle)
  return core.length >= 2 && normalizeEvidence(homepageTitle).includes(core)
}

function phonesMatch(a: string | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const digitsA = a.normalize('NFKC').replace(/\D/g, '')
  const digitsB = b.normalize('NFKC').replace(/\D/g, '')
  if (digitsA.length < 9 || digitsB.length < 9) return false
  // 国番号 +81 表記の差を吸収するため末尾9桁で比較する
  return digitsA.slice(-9) === digitsB.slice(-9)
}

/**
 * First-party identity must be decided independently from area and industry.
 * A company name in the title or multiple corporate-profile labels are useful
 * identity signals; neither requires the target address or service to appear on
 * the same page.
 */
function containsFirstPartyIdentityEvidence(title: string, text: string): boolean {
  const titleHasEntityName = /(?:株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|税理士法人|弁護士法人|行政書士法人|司法書士法人|医療法人|社会福祉法人|\b(?:inc\.?|corp\.?|corporation|ltd\.?|llc)\b)/iu.test(title)
  const normalizedText = text.normalize('NFKC')
  const corporateLabels = [
    /会社概要|企業情報|法人概要|店舗概要|サロン概要/u,
    /事業内容|業務内容|提供サービス/u,
    /所在地|本社所在地|本店所在地|店舗所在地/u,
    /代表者|代表取締役|設立|資本金/u,
  ].filter((pattern) => pattern.test(normalizedText)).length
  return titleHasEntityName || corporateLabels >= 2
}

/**
 * ページ本文中の地区名が「所在地」を示す文脈かを判定する。
 * 「渋谷区対応」「渋谷区のおすすめ」のような対応エリア・紹介記事表現は
 * 所在地の証拠として扱わない（精度目標.md 地区判定）。
 */
function pageMentionsAreaAsLocation(text: string, rawArea: string): boolean {
  const needle = areaNeedle(rawArea)
  if (!needle || !text.trim()) return false
  const haystack = normalizeEvidence(text)
  let from = 0
  while (from < haystack.length) {
    const index = haystack.indexOf(needle, from)
    if (index < 0) return false
    const after = haystack.slice(index + needle.length, index + needle.length + 12)
    const serviceAreaClaim = /^(?:対応|対象|全域|近郊|周辺|エリア|への出張|に出張|のおすすめ|おすすめ|ランキング|人気)/u.test(after)
    if (!serviceAreaClaim) return true
    from = index + needle.length
  }
  return false
}

/**
 * 事業者候補の採用判定（精度目標.md 準拠）。
 *
 * - 採用証拠は加点方式: 住所一致・カテゴリ/タイトル/自己申告の業種整合・
 *   名称一致・電話一致などの組み合わせで採用する。
 * - 明確な矛盾のみ除外方式: 地区外住所しかない・業種の自己否定・
 *   ポータル/記事ページ・予約サービスへのリダイレクトなど。
 * - 情報不足だけでは除外せず 'hold'（保留・追加確認）として返す。
 */
export function evaluateCandidateRelevance(
  input: CandidateRelevanceInput,
): CandidateRelevanceDecision {
  let validUrl = false
  try {
    const parsed = new URL(input.url)
    validUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    validUrl = false
  }
  if (!validUrl) {
    return {
      status: 'rejected',
      reasons: ['invalid_url'],
      areaMatched: false,
      industryMatched: false,
      officialSite: false,
      score: 0,
      evidence: [],
    }
  }

  const strictArea = input.searchArea || input.area
  const listedSource = input.source === 'places' || input.source === 'portal'
  const evidencePageKinds = new Set(input.evidencePageKinds ?? [])
  const reasons: CandidateRejectionReason[] = []
  const evidence: string[] = []

  // ── 公式サイト性の明確な矛盾 ──────────────────────────
  const officialContradiction = isKnownNonOfficialUrl(input.url)
    || Boolean(input.redirectedToNonOfficial)
    || Boolean(input.hasDirectorySchema)
    || isLikelyNonOfficialContentPage(input.url)
    || (input.source === 'organic' && isLikelyListingPageTitle(input.homepageTitle || input.sourceTitle || ''))

  // ── 地区の証拠 ───────────────────────────────────────
  const sourceAddress = input.sourceAddress?.trim() ?? ''
  const extractedAddress = input.extractedAddress?.trim() ?? ''
  const sourceAddressInArea = Boolean(sourceAddress) && isAddressInArea(sourceAddress, strictArea)
  const extractedAddressInArea = Boolean(extractedAddress) && isAddressInArea(extractedAddress, strictArea)
  // 本社が地区外でも、掲載元（支店）住所が地区内なら対象（精度目標.md 地区判定）
  const addressInArea = sourceAddressInArea || extractedAddressInArea
  const hasAnyAddress = Boolean(sourceAddress || extractedAddress)
  const areaContradiction = hasAnyAddress && !addressInArea
  const pageAreaText = [input.homepageTitle, input.homepageText].filter(Boolean).join(' ')
  const weakAreaMention = !hasAnyAddress && pageMentionsAreaAsLocation(pageAreaText, strictArea)
  const areaMatched = addressInArea || weakAreaMention
  if (sourceAddressInArea) evidence.push('source_address_in_area')
  if (extractedAddressInArea) evidence.push('extracted_address_in_area')
  if (weakAreaMention) evidence.push('area_text_mention')

  // ── 業種の証拠（同義語・カテゴリ整合を含む加点材料） ──
  const rawTerms = [...new Set([input.industry, ...input.keywords].map((term) => term.trim()).filter(Boolean))]
  const stemmedTerms = [...new Set(rawTerms.flatMap((term) => {
    const stem = term.replace(/(?:専門店|会社|事業者|業者|事務所|サービス|事業)$/u, '')
    return stem.length >= 2 && stem !== term ? [term, stem] : [term]
  }))]
  const terms = expandIndustryTerms(stemmedTerms)
  const listingIndustryEvidence = listedSource ? [input.sourceTitle, input.sourceCategory]
    .filter(Boolean)
    .join(' ') : ''
  const listingMatch = containsIndustryEvidence(listingIndustryEvidence, terms)
  const titleMatch = containsIndustryEvidence(input.homepageTitle ?? '', terms)
  const selfDeclared = !input.hasDirectorySchema
    && (isLikelyOfficialCorporatePage(input.url)
      || evidencePageKinds.has('company')
      || evidencePageKinds.has('service'))
    && containsSelfDeclaredIndustryEvidence(input.homepageText ?? '', terms)
  const bodyMention = containsIndustryEvidence(input.homepageText ?? '', terms)
  const negativeIndustry = containsNegativeIndustryEvidence(input.homepageText ?? '', terms)
  const industryLevel = (selfDeclared || listingMatch) ? 3 : titleMatch ? 2 : bodyMention ? 1 : 0
  const industryMatched = industryLevel >= 2 && !negativeIndustry
  if (listingMatch) evidence.push('listing_category_match')
  if (titleMatch) evidence.push('homepage_title_match')
  if (selfDeclared) evidence.push('self_declared_industry')
  if (!selfDeclared && !listingMatch && !titleMatch && bodyMention) evidence.push('body_industry_mention')

  // ── 同一性の証拠 ─────────────────────────────────────
  const nameMatch = listedSource && namesMatch(input.sourceTitle, input.homepageTitle)
  const phoneMatch = phonesMatch(input.sourcePhone, input.extractedPhone)
  if (nameMatch) evidence.push('name_match')
  if (phoneMatch) evidence.push('phone_match')
  if (input.hasBusinessSchema) evidence.push('business_schema')
  if (listedSource) evidence.push('listed_source')

  const score = (addressInArea ? 3 : weakAreaMention ? 1 : 0)
    + industryLevel
    + (nameMatch ? 2 : 0)
    + (phoneMatch ? 3 : 0)
    + (input.hasBusinessSchema ? 1 : 0)
    + (listedSource ? 2 : 0)

  // 公式性は地区・業種とは独立して判定する。住所は会社概要、業種は
  // サービスページというように証拠が別ページへ分かれる通常の企業サイトを
  // 「非公式」と誤判定しないため。
  const firstPartyIdentity = Boolean(input.hasBusinessSchema)
    || evidencePageKinds.has('company')
    || (isLikelyOfficialCorporatePage(input.url)
      && Boolean(input.extractedAddress || input.extractedPhone))
    || containsFirstPartyIdentityEvidence(input.homepageTitle ?? '', input.homepageText ?? '')
  const listedIdentity = input.source === 'places'
    || (input.source === 'portal' && (nameMatch || phoneMatch || firstPartyIdentity))
  const officialSite = !officialContradiction && (listedIdentity || (!listedSource && firstPartyIdentity))
  if (officialSite) evidence.push('official_identity_match')

  // ── 明確な矛盾 → 除外 ────────────────────────────────
  if (officialContradiction) reasons.push('unverified_official_site')
  if (areaContradiction) reasons.push('area_mismatch')
  if (negativeIndustry) reasons.push('negative_industry_evidence')
  if (reasons.length > 0) {
    return { status: 'rejected', reasons, areaMatched, industryMatched, officialSite, score, evidence }
  }

  // ── 採用可能な組み合わせ（加点方式） ──────────────────
  const accepted = officialSite && areaMatched && industryMatched
  if (accepted) {
    return { status: 'accepted', reasons: [], areaMatched, industryMatched, officialSite, score, evidence }
  }

  // ── 情報不足 → 保留（追加確認へ） ────────────────────
  if (!areaMatched) reasons.push('missing_area_evidence')
  if (!industryMatched) reasons.push('missing_industry_evidence')
  if (!officialSite) reasons.push('unverified_official_site')
  if (reasons.length === 0) reasons.push('insufficient_evidence')
  return { status: 'hold', reasons, areaMatched, industryMatched, officialSite, score, evidence }
}
