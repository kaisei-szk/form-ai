export type CandidateSource = 'places' | 'organic'

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
  extractedAddress?: string | null
  homepageTitle?: string | null
  homepageText?: string | null
  hasBusinessSchema?: boolean
  hasDirectorySchema?: boolean
  redirectedToNonOfficial?: boolean
}

export type CandidateRejectionReason =
  | 'invalid_url'
  | 'unverified_official_site'
  | 'missing_area_evidence'
  | 'area_mismatch'
  | 'missing_industry_evidence'
  | 'negative_industry_evidence'

export interface CandidateRelevanceDecision {
  status: 'accepted' | 'rejected'
  reasons: CandidateRejectionReason[]
  areaMatched: boolean
  industryMatched: boolean
  officialSite: boolean
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
    return /\/(?:press(?:release)?|news|articles?|columns?|blogs?|jobs?|careers?|professional|companies|item)(?:\/|$)/u.test(path)
  } catch {
    return true
  }
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

/**
 * Precision-first admission gate. A candidate is accepted only when all of
 * the following are evidenced: official site, requested area, requested
 * industry. Search ranking by itself is never treated as proof.
 */
export function evaluateCandidateRelevance(
  input: CandidateRelevanceInput,
): CandidateRelevanceDecision {
  const reasons: CandidateRejectionReason[] = []

  let validUrl = false
  try {
    const parsed = new URL(input.url)
    validUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    validUrl = false
  }
  if (!validUrl) reasons.push('invalid_url')

  const strictArea = input.searchArea || input.area
  const authoritativeAddress = input.sourceAddress?.trim() || input.extractedAddress?.trim() || ''
  let areaMatched = false
  if (authoritativeAddress) {
    areaMatched = isAddressInArea(authoritativeAddress, strictArea)
    if (!areaMatched) reasons.push('area_mismatch')
  } else {
    const pageAreaEvidence = [input.homepageTitle, input.homepageText]
      .filter(Boolean)
      .join(' ')
    areaMatched = isAddressInArea(pageAreaEvidence, strictArea)
    if (!areaMatched) reasons.push('missing_area_evidence')
  }

  const rawTerms = [...new Set([input.industry, ...input.keywords].map((term) => term.trim()).filter(Boolean))]
  const terms = [...new Set(rawTerms.flatMap((term) => {
    const stem = term.replace(/(?:専門店|会社|事業者|業者|事務所|サービス|事業)$/u, '')
    return stem.length >= 2 && stem !== term ? [term, stem] : [term]
  }))]
  const listingIndustryEvidence = [input.sourceTitle, input.sourceCategory]
    .filter(Boolean)
    .join(' ')
  const titleIndustryMatched = containsIndustryEvidence(input.homepageTitle ?? '', terms)
  const negativeIndustryMatched = containsNegativeIndustryEvidence(input.homepageText ?? '', terms)
  const qualifiedBodyIndustryMatched = !input.hasDirectorySchema
    && isLikelyOfficialCorporatePage(input.url)
    && containsSelfDeclaredIndustryEvidence(input.homepageText ?? '', terms)
  // Search snippets can quote unrelated articles and are never proof of the
  // company's own business. Places may additionally rely on its registered
  // name/category; both sources may rely on a qualified official page.
  const positiveIndustryMatched = input.source === 'organic'
    ? (!isLikelyNonOfficialContentPage(input.url) && titleIndustryMatched)
      || qualifiedBodyIndustryMatched
    : containsIndustryEvidence(listingIndustryEvidence, terms)
      || titleIndustryMatched
      || qualifiedBodyIndustryMatched
  const industryMatched = positiveIndustryMatched && !negativeIndustryMatched
  if (!industryMatched) reasons.push('missing_industry_evidence')
  if (negativeIndustryMatched) reasons.push('negative_industry_evidence')

  // Places registers the website against a business listing. Organic results
  // are admitted only with independent on-site proof: an extracted address in
  // the exact requested area and matching industry content. This prevents a
  // search article or directory snippet from being treated as an official HP.
  const organicOfficialSite = input.source === 'organic'
    && Boolean(input.extractedAddress?.trim())
    && isAddressInArea(input.extractedAddress ?? '', strictArea)
    && industryMatched
  const officialSite = validUrl
    && !isKnownNonOfficialUrl(input.url)
    && !input.redirectedToNonOfficial
    && !input.hasDirectorySchema
    && !isLikelyNonOfficialContentPage(input.url)
    && (input.source === 'places' || organicOfficialSite)
  if (!officialSite && validUrl) reasons.push('unverified_official_site')

  return {
    status: reasons.length === 0 ? 'accepted' : 'rejected',
    reasons,
    areaMatched,
    industryMatched,
    officialSite,
  }
}
