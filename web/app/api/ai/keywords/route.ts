import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import OpenAI from 'openai'
import { expandIndustryTerms } from '@/lib/industry-synonyms'

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
        content: 'あなたは事業者候補を漏れなく発見するための検索語監査者です。最終採用判定は別工程で行われます。JSONのみ返してください。',
      },
      {
        role: 'user',
        content: `対象業種は「${industry}」です。次の候補から、この業種を提供する事業者の発見に有効な検索表現だけを残してください。

候補: ${JSON.stringify(candidates)}

判定ルール:
- 同義語、業界上の別称、その業務を提供する会社が自社サイトで使うサービス表現は残す
- 例: SNS運用会社に対する「SNSマーケティング支援」「アカウント運用支援」のような表現は残してよい
- 検索語は候補発見専用であり、その語にヒットしただけでは最終結果へ採用しない
- 明らかな隣接業種、上位概念だけの語、顧客の悩み、商品名、役職、仲介プラットフォームは除外
- 検索意図（予約・料金・求人・比較等）は除外
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
      && isDiscoveryKeyword(keyword)
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
        content: `業種「${industry}」を提供する事業者を発見するため、独立した検索語にできる専門業態名・サービス表現を最大${maxKeywords}個返してください。

条件:
- 実際の事業者が自社サイトの事業・サービス名として使う表現にする
- 同義語だけでなく、対象業務の提供会社を見つけられる「◯◯支援」「◯◯運用」等もよい
- 明らかな隣接業種、商品名、役職名、集客語、比較・求人語、プラットフォームは除外
- 業界で使われていない作り語は除外し、数合わせしない
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
      .filter((keyword: string) => isDiscoveryKeyword(keyword))
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

function isDiscoveryKeyword(keyword: string): boolean {
  const value = keyword.normalize('NFKC').trim()
  if (!value || /\b(?:AND|OR)\b|[|()]/iu.test(value)) return false

  // Discovery terms may be service expressions (e.g. 「アカウント運用支援」),
  // but search intent, employment and editorial phrases are never useful here.
  if (/(?:予約|メニュー|料金|価格|求人|採用|業界|市場|経営|オーナー|スタッフ|アシスタント|施術|口コミ|ランキング|比較|おすすめ|一覧|ブログ|ニュース|スクール|資格|開業|jobs?|recruit(?:ment)?|booking|reservation|prices?|menus?|reviews?|ranking)$/iu.test(value)) {
    return false
  }
  return value.length >= 2
}

export async function POST(req: NextRequest) {
  try {
    const { industry } = Schema.parse(await req.json())

    const cacheKey = industry.normalize('NFKC').trim().toLowerCase()
    const cached = cache.get(cacheKey)
    if (cached) return NextResponse.json({ success: true, ...cached })

    const dictionaryKeywords = expandIndustryTerms([industry]).filter(isDiscoveryKeyword)
    const openai = getOpenAI()
    if (!openai) {
      const result = { keywords: deduplicateKeywords([industry, ...dictionaryKeywords]) }
      cache.set(cacheKey, result)
      return NextResponse.json({ success: true, ...result, fallback: true })
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
          content: `業種「${industry}」を提供する事業者候補を、Serperで漏れなく探すための独立検索語を最大${maxKeywords}個設計してください。

【ルール】
1. 必ず「${industry}」を最初に含める
2. 次の4種類を検討する: (a) 同義語・一般的な別称、(b) 日英の業種名、(c) 専門業態名、(d) 事業者が自社の提供業務を表すサービス表現
3. 例えばSNS運用会社なら「SNSマーケティング支援」「SNSアカウント運用」「Instagram運用支援」のような、提供会社の発見に有効な表現も候補にする
4. 各検索語は単独で検索する。AND、OR、括弧、引用符、エリア名を含めない
5. 検索語は候補発見にのみ使い、最終採用は公式サイトの地区・業種確認で別に行う
6. 明らかな隣接業種、上位概念だけの語、顧客の悩み、商品名、求人・比較・予約語は追加しない
7. 実際の事業者が使う自然な表現に限り、作り語で数合わせしない

JSON（コメント不要）：{"keywords": ["..."]}"`,
        },
      ],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: 'json_object' },
    }).catch(() => null)

    if (!resp) {
      const result = { keywords: deduplicateKeywords([industry, ...dictionaryKeywords]) }
      cache.set(cacheKey, result)
      return NextResponse.json({ success: true, ...result, fallback: true })
    }

    let keywords: string[] = [industry]

    try {
      const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}')
      if (Array.isArray(parsed.keywords) && parsed.keywords.length > 0) {
        // Ensure industry itself is first, deduplicate
        const kws = parsed.keywords
          .filter((k: unknown) => typeof k === 'string' && k.trim())
          .filter((k: string) => isDiscoveryKeyword(k))
          .slice(0, maxKeywords)
        // Industry must be present (use original form)
        if (!kws.some((k: string) => k.includes(industry) || industry.includes(k))) {
          kws.unshift(industry)
        }
        const generated = deduplicateKeywords([...kws, ...dictionaryKeywords]).slice(0, maxKeywords)
        const subtypes = await generateBusinessSubtypes(openai, industry, maxKeywords)
        const candidates = deduplicateKeywords([...generated, ...subtypes]).slice(0, maxKeywords)
        keywords = await validateKeywordsWithAi(openai, industry, candidates)
      }
    } catch {
      keywords = deduplicateKeywords([industry, ...dictionaryKeywords])
    }

    if (keywords.length === 0) keywords = [industry]

    const result = { keywords }
    cache.set(cacheKey, result)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 })
  }
}
