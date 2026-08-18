import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import OpenAI from 'openai'

const Schema = z.object({
  industry: z.string().min(1).max(100),
  area: z.string().min(1).max(100).optional(),
})

const cache = new Map<string, { keywords: string[] }>()

let _openai: OpenAI | null = null
function getOpenAI() {
  if (!_openai && process.env.OPENAI_API_KEY) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

async function validateKeywordsWithAi(
  openai: OpenAI,
  industry: string,
  candidates: string[],
): Promise<string[]> {
  if (candidates.length <= 1) return candidates

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'あなたは検索語の精度監査者です。指定業種以外の事業者を混入させないことが最優先です。JSONのみ返してください。',
      },
      {
        role: 'user',
        content: `対象業種は「${industry}」です。次の候補から、検索結果に出る事業者のほぼ全てを「${industry}」として収録してよい語だけを残してください。

候補: ${JSON.stringify(candidates)}

厳密な除外ルール:
- 隣接業種、上位概念、幅広い関連業種は除外
- サービス名、施術名、役職・個人の職種、仲介プラットフォームは除外
- 別の業種も一般的に表す多義的な語は除外。対象業種だけを意味すると確信できる語に限る
- 検索意図（予約・料金・求人・比較等）は除外
- 同義語、業界で一般的な別称、対象業種の明確な下位分類だけを残す
- 迷う語は除外する
- 対象業種そのものは必ず残す

JSON: {"keywords":["..."]}`,
      },
    ],
    max_tokens: 400,
    temperature: 0,
    response_format: { type: 'json_object' },
  })

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}')
    if (!Array.isArray(parsed.keywords)) return [industry]
    const allowed = new Set(candidates.map((keyword) => keyword.normalize('NFKC').trim().toLowerCase()))
    const validated = parsed.keywords.filter((keyword: unknown): keyword is string =>
      typeof keyword === 'string'
      && allowed.has(keyword.normalize('NFKC').trim().toLowerCase())
      && isBusinessEntityKeyword(keyword, industry)
    )
    return deduplicateKeywords([industry, ...validated])
  } catch {
    return [industry]
  }
}

async function generateBusinessSubtypes(
  openai: OpenAI,
  industry: string,
  maxKeywords: number,
): Promise<string[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'あなたは業態分類の専門家です。JSONのみ返してください。',
      },
      {
        role: 'user',
        content: `業種「${industry}」の中に完全に含まれる、独立した検索語にできる専門業態名を最大${maxKeywords}個返してください。

条件:
- その語で見つかる店・会社・事業者のほぼ全てが「${industry}」に属する
- 隣接業種、関連サービス、施術名、商品名、役職名、集客語、プラットフォームは除外
- 業態として普及した名称だけ。作り語は除外
- 安全な専門業態がなければ空配列を返す。数合わせしない
- AND、OR、エリア名は含めない

JSON: {"keywords":["..."]}`,
      },
    ],
    max_tokens: 400,
    temperature: 0,
    response_format: { type: 'json_object' },
  })

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}')
    if (!Array.isArray(parsed.keywords)) return []
    return parsed.keywords
      .filter((keyword: unknown): keyword is string => typeof keyword === 'string')
      .filter((keyword: string) => isBusinessEntityKeyword(keyword, industry))
      .slice(0, maxKeywords)
  } catch {
    return []
  }
}

function deduplicateKeywords(keywords: string[]): string[] {
  const seen = new Set<string>()
  return keywords.filter((keyword) => {
    const normalized = keyword.normalize('NFKC').trim().toLowerCase()
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function isBusinessEntityKeyword(keyword: string, industry: string): boolean {
  const value = keyword.normalize('NFKC').trim()
  const base = industry.normalize('NFKC').trim()
  if (!value || /\b(?:AND|OR)\b|[|()]/iu.test(value)) return false

  // Reject search intent, employment, content and management phrases. They
  // describe something related to an industry, not a business in that industry.
  if (/(?:予約|メニュー|料金|価格|求人|採用|業界|市場|経営|オーナー|スタッフ|アシスタント|施術|口コミ|ランキング|比較|おすすめ|一覧|ブログ|ニュース|スクール|資格|開業|jobs?|recruit(?:ment)?|booking|reservation|prices?|menus?|reviews?|ranking)$/iu.test(value)) {
    return false
  }
  if (/(?:アドバイザー|コンサルタント|ブローカー|エージェント|スタイリスト|セラピスト|advisors?|consultants?|brokers?|agents?)$/iu.test(value)) {
    return false
  }

  // When the user names a company/provider category, preserve its distinctive
  // business stem. This prevents a neighboring profession from being treated
  // as an equivalent merely because both operate in the same field.
  const entitySuffixRe = /(?:専門店|店舗|店|会社|事業者|業者|事務所|センター|クリニック|サロン|院|所)$/u
  const baseStem = base.replace(entitySuffixRe, '')
  if (baseStem !== base && baseStem.length >= 2 && !value.includes(baseStem)) return false

  // Appending a service/action to the original industry is query padding.
  // Appending a business-entity designator remains valid (e.g. 「会社」「専門店」).
  if (value.startsWith(base) && value !== base) {
    const tail = value.slice(base.length)
    if (!/(?:専門店|店舗|店|会社|事業者|業者|事務所|センター|クリニック|サロン|院|所|チェーン)$/u.test(tail)) return false
  }

  return value.length >= 2
}

export async function POST(req: NextRequest) {
  try {
    const { industry } = Schema.parse(await req.json())

    const cacheKey = industry.normalize('NFKC').trim().toLowerCase()
    const cached = cache.get(cacheKey)
    if (cached) return NextResponse.json({ success: true, ...cached })

    const openai = getOpenAI()
    if (!openai) {
      return NextResponse.json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 })
    }

    const maxKeywords = 20

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'あなたはローカル事業者検索の検索語設計エキスパートです。JSONのみ返してください。',
        },
        {
          role: 'user',
          content: `業種「${industry}」に該当する事業者を、Serperのローカル検索で漏れなく探すための独立検索語を最大${maxKeywords}個設計してください。

【ルール】
1. 必ず「${industry}」を最初に含める
2. 次の3種類を検討する: (a) 同義語・一般的な別称、(b) Googleローカル検索で使われる日英の業種名、(c) 店・会社・事業者の種類を表す明確な専門業態名
3. 隣接業種、関連サービス、顧客の悩み、商品名、求人語は絶対に追加しない
4. 各検索語は単独で検索する。AND、OR、括弧、引用符、エリア名を含めない
5. その語に該当する事業者を「${industry}」の事業者としてリストへ入れて問題ない語だけを返す
6. 「予約」「メニュー」「サービス」「業界」「経営」「施術」などを足して数合わせしない。語が少ない業種は少数のまま終える
7. 専門業態は、その語で見つかる事業者が必ず「${industry}」に属する場合だけ採用する。単なる施術・商品・職種名は不可

JSON（コメント不要）：{"keywords": ["..."]}"`,
        },
      ],
      max_tokens: 300,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    })

    let keywords: string[] = [industry]

    try {
      const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}')
      if (Array.isArray(parsed.keywords) && parsed.keywords.length > 0) {
        // Ensure industry itself is first, deduplicate
        const kws = parsed.keywords
          .filter((k: unknown) => typeof k === 'string' && k.trim())
          .filter((k: string) => isBusinessEntityKeyword(k, industry))
          .slice(0, maxKeywords)
        // Industry must be present (use original form)
        if (!kws.some((k: string) => k.includes(industry) || industry.includes(k))) {
          kws.unshift(industry)
        }
        const generated = deduplicateKeywords(kws).slice(0, maxKeywords)
        const subtypes = await generateBusinessSubtypes(openai, industry, maxKeywords)
        const candidates = deduplicateKeywords([...generated, ...subtypes]).slice(0, maxKeywords)
        keywords = await validateKeywordsWithAi(openai, industry, candidates)
      }
    } catch {
      keywords = [industry]
    }

    if (keywords.length === 0) keywords = [industry]

    const result = { keywords }
    cache.set(cacheKey, result)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 })
  }
}
