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

function deduplicateKeywords(keywords: string[]): string[] {
  const seen = new Set<string>()
  return keywords.filter((keyword) => {
    const normalized = keyword.normalize('NFKC').trim().toLowerCase()
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
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

    const maxKeywords = 12

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
2. 同義語・一般的な別称・その業種に内包される明確な専門分類だけを追加する
3. 隣接業種、関連サービス、顧客の悩み、商品名、求人語は絶対に追加しない
4. 各検索語は単独で検索する。AND、OR、括弧、引用符、エリア名を含めない
5. その語に該当する事業者を「${industry}」の事業者としてリストへ入れて問題ない語だけを返す

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
          .slice(0, maxKeywords)
        // Industry must be present (use original form)
        if (!kws.some((k: string) => k.includes(industry) || industry.includes(k))) {
          kws.unshift(industry)
        }
        keywords = deduplicateKeywords(kws).slice(0, maxKeywords)
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
