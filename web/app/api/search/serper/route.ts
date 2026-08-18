import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runSerperSearch } from '@/lib/serper'
import { validateAreaInput } from '@/lib/search-relevance'

export const maxDuration = 300

const Schema = z.object({
  keywords:   z.array(z.string()).default([]),
  industry:   z.string().optional(),
  area:       z.string().min(1),
  maxResults: z.number().int().min(0).default(0),
})

export async function POST(req: NextRequest) {
  try {
    const raw = Schema.parse(await req.json())
    const effectiveKeywords = raw.keywords.length > 0
      ? raw.keywords
      : raw.industry ? [raw.industry] : raw.keywords
    const body = { ...raw, keywords: effectiveKeywords }
    if (body.keywords.length === 0) {
      return NextResponse.json({ success: false, error: 'keywords or industry is required' }, { status: 400 })
    }
    const areaValidation = validateAreaInput(body.area)
    if (!areaValidation.valid) {
      return NextResponse.json({ success: false, error: areaValidation.reason }, { status: 400 })
    }

    const apiKey = process.env.SERPER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'SERPER_API_KEY not configured' }, { status: 500 })
    }

    const { items, stats, errors, error: apiErr } = await runSerperSearch({
      keywords: body.keywords,
      area: areaValidation.normalized,
      maxResults: body.maxResults,
      apiKey,
    })

    if (apiErr && items.length === 0) {
      return NextResponse.json({ success: false, error: `Serper API error: ${apiErr.status} ${apiErr.text}` }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      stats,
      errors,
      ...(apiErr && { warning: `一部のSerper検索に失敗しました: ${apiErr.status} ${apiErr.text}` }),
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 })
  }
}
