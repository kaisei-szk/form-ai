import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runSerperSearch, extractHost } from '@/lib/serper'
import { runPortalDiscovery, businessDedupeKey, type PortalDiscoveryStats } from '@/lib/portal-discovery'
import { validateAreaInput } from '@/lib/search-relevance'
import { addCompanies } from '@/lib/companies-db'

export const maxDuration = 300

const Schema = z.object({
  keywords:   z.array(z.string()).default([]),
  industry:   z.string().optional(),
  area:       z.string().min(1),
  maxResults: z.number().int().min(0).default(0),
  projectId:  z.string().optional(),
  runId:      z.string().optional(),
  includePortals: z.boolean().default(true),
})

function readBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

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

    const startedAt = Date.now()
    const timeBudgetMs = readBoundedInt(process.env.SERPER_TIME_BUDGET_MS, 240_000, 60_000, 1_800_000)
    const deadline = startedAt + timeBudgetMs
    // ポータル発見は本検索と別枠の時間予算を持つ。本検索が予算を使い切っても
    // ポータル経由の候補拡大が打ち切られないようにする（精度目標.md 候補母数の拡大）。
    const portalBudgetMs = readBoundedInt(process.env.SERPER_PORTAL_TIME_BUDGET_MS, 180_000, 0, 1_800_000)

    const { items, noWebsitePlaces, stats, errors, error: apiErr } = await runSerperSearch({
      keywords: body.keywords,
      area: areaValidation.normalized,
      maxResults: body.maxResults,
      apiKey,
    })

    if (apiErr && items.length === 0) {
      return NextResponse.json({ success: false, error: `Serper API error: ${apiErr.status} ${apiErr.text}` }, { status: 502 })
    }

    // ── ポータル発見（候補母数の拡大） ─────────────────────
    // ポータル・名簿の掲載事業者を抽出し、公式リンク確認とSerper再検索で
    // 公式HP候補を追加する。公式HPが見つからない事業者は「公式HP未発見」
    // として別枠でDBに保存する（精度目標.md ポータルの扱い）。
    let portalStats: PortalDiscoveryStats | undefined
    let hpNotFoundCount = 0
    let hpNotFoundSaved = 0
    const portalDeadline = Math.max(deadline, Date.now() + portalBudgetMs)
    if (body.includePortals && Date.now() < portalDeadline - 15_000) {
      const existingKeys = new Set(items.map((item) => businessDedupeKey(item.title, item.phone, item.address)))
      const existingHosts = new Set(items.map((item) => extractHost(item.link)).filter(Boolean))
      // Placesに載っているが公式サイトURLが無い事業者も、公式HP再検索と
      // 「公式HP未発見」保存の対象に含める（捨てずに候補母数へ算入）。
      const placeBusinesses = noWebsitePlaces.map((place) => ({
        name: place.name,
        address: place.address,
        phone: place.phone,
        category: place.category,
        officialUrl: null,
        portalHost: 'google-maps',
        portalUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name} ${place.address}`.trim())}`,
      }))
      const portal = await runPortalDiscovery({
        keywords: body.keywords,
        area: areaValidation.normalized,
        apiKey,
        deadline: portalDeadline,
        existingKeys,
        existingHosts,
        extraBusinesses: placeBusinesses,
      })
      items.push(...portal.candidates)
      portalStats = portal.stats
      hpNotFoundCount = portal.hpNotFound.length

      if (portal.hpNotFound.length > 0 && (body.runId || body.projectId)) {
        try {
          const { added } = await addCompanies(portal.hpNotFound.map((business) => ({
            name: business.name,
            hpUrl: business.portalUrl,
            formUrl: '',
            phone: business.phone,
            address: business.address,
            industry: body.industry || body.keywords[0] || '',
            area: areaValidation.normalized,
            status: '公式HP未発見',
            notes: `発見元: ${business.portalHost}`,
            projectId: body.projectId,
            runId: body.runId,
          })))
          hpNotFoundSaved = added
        } catch {
          // 未発見枠の保存失敗で検索全体を失敗させない
        }
      }
    }

    stats.candidateCount = items.length

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      stats,
      ...(portalStats && { portalStats }),
      hpNotFoundCount,
      hpNotFoundSaved,
      errors,
      ...(apiErr && { warning: `一部のSerper検索に失敗しました: ${apiErr.status} ${apiErr.text}` }),
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 })
  }
}
