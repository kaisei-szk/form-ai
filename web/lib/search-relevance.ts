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
}

export type CandidateRejectionReason =
  | 'invalid_url'
  | 'unverified_official_site'
  | 'missing_area_evidence'
  | 'area_mismatch'
  | 'missing_industry_evidence'

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

function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000・･,，.。/／\\|｜「」『』【】()（）［］\[\]{}]/g, '')
}

function areaNeedle(rawArea: string): string {
  return normalizeEvidence(normalizeAreaName(rawArea))
    .replace(/(?:駅周辺|駅付近|周辺|付近)$/u, '')
}

/** Strict area test used both before and after fetching a candidate HP. */
export function isAddressInArea(address: string, rawArea: string): boolean {
  const needle = areaNeedle(rawArea)
  if (!needle || !address.trim()) return false
  return normalizeEvidence(address).includes(needle)
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

  // The Serper Places website field is registered against the business
  // listing, so it is accepted as official-site evidence. Organic results are
  // deliberately not auto-admitted because articles and directories can rank.
  const officialSite = validUrl && input.source === 'places'
  if (!officialSite && validUrl) reasons.push('unverified_official_site')

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

  const terms = [...new Set([input.industry, ...input.keywords].map((term) => term.trim()).filter(Boolean))]
  const primaryIndustryEvidence = [
    input.sourceTitle,
    input.sourceCategory,
    input.sourceSnippet,
    input.homepageTitle,
    input.homepageText,
  ].filter(Boolean).join(' ')
  const industryMatched = containsIndustryEvidence(primaryIndustryEvidence, terms)
  if (!industryMatched) reasons.push('missing_industry_evidence')

  return {
    status: reasons.length === 0 ? 'accepted' : 'rejected',
    reasons,
    areaMatched,
    industryMatched,
    officialSite,
  }
}
