import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runSerperSearch } from '@/lib/serper'
import { runPortalDiscovery, businessDedupeKey, type PortalDiscoveryStats } from '@/lib/portal-discovery'
import {
  getRetryableDiscoveredBusinesses,
  recordDiscoveredBusinessAttempts,
  upsertDiscoveredBusinesses,
  type StoredDiscoveredBusiness,
} from '@/lib/discovered-businesses-db'
import { validateAreaInput } from '@/lib/search-relevance'
import {
  getProjectRun,
  getRunSearchCheckpoint,
  updateRunSearchProgress,
  updateRunStatus,
} from '@/lib/project-manager'
import { getAllSearchCandidates, upsertSearchCandidates } from '@/lib/search-candidates-db'
import { getErrorMessage } from '@/lib/error-message'

export const maxDuration = 5400

const Schema = z.object({
  keywords:   z.array(z.string()).default([]),
  industry:   z.string().optional(),
  area:       z.string().min(1),
  maxResults: z.number().int().min(0).default(0),
  projectId:  z.string().optional(),
  runId:      z.string().optional(),
  resumeFromRunId: z.string().optional(),
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
    const timeBudgetMs = readBoundedInt(process.env.SERPER_TIME_BUDGET_MS, 2_700_000, 60_000, 3_600_000)
    const deadline = startedAt + timeBudgetMs
    // ポータル発見は本検索と別枠の時間予算を持つ。本検索が予算を使い切っても
    // ポータル経由の候補拡大が打ち切られないようにする（精度目標.md 候補母数の拡大）。
    const portalBudgetMs = readBoundedInt(process.env.SERPER_PORTAL_TIME_BUDGET_MS, 1_800_000, 0, 3_600_000)

    const checkpointSourceRunId = body.resumeFromRunId ?? body.runId
    const checkpoint = checkpointSourceRunId
      ? await getRunSearchCheckpoint(checkpointSourceRunId)
      : undefined
    const persistenceWarnings: string[] = []
    const persistedCandidateUrls = new Set<string>()
    const persistCandidates = async (candidates: Parameters<typeof upsertSearchCandidates>[0]['candidates']) => {
      if (!body.projectId || !body.runId) return
      const pending = candidates.filter((candidate) => {
        const key = candidate.link.trim()
        return key && !persistedCandidateUrls.has(key)
      })
      if (pending.length === 0) return
      try {
        await upsertSearchCandidates({
          projectId: body.projectId,
          runId: body.runId,
          candidates: pending,
          industry: body.industry || body.keywords[0] || '',
        })
        pending.forEach((candidate) => persistedCandidateUrls.add(candidate.link.trim()))
      } catch (error) {
        persistenceWarnings.push(`発見候補の保存に失敗しました: ${getErrorMessage(error)}`)
      }
    }
    let lastProgressWriteAt = 0
    const { items, noWebsitePlaces, stats, errors, error: apiErr } = await runSerperSearch({
      keywords: body.keywords,
      area: areaValidation.normalized,
      maxResults: body.maxResults,
      apiKey,
      timeBudgetMs,
      checkpoint,
      onProgress: body.runId ? async (progress, durableCheckpoint) => {
        const now = Date.now()
        if (!durableCheckpoint && now - lastProgressWriteAt < 2_000) return
        if (durableCheckpoint) await persistCandidates(durableCheckpoint.items)
        try {
          await updateRunSearchProgress(
            body.runId!,
            { ...progress, resumedFromRunId: checkpoint ? checkpointSourceRunId : undefined },
            durableCheckpoint,
          )
          lastProgressWriteAt = now
        } catch (error) {
          persistenceWarnings.push(`検索進捗の保存に失敗しました: ${getErrorMessage(error)}`)
        }
      } : undefined,
    })

    if (apiErr && items.length === 0) {
      return NextResponse.json({ success: false, error: `Serper API error: ${apiErr.status} ${apiErr.text}` }, { status: 502 })
    }

    // Durable holds are not final output, but they must not disappear. Re-add
    // them to the next same-condition run so the richer site evidence pass can
    // promote or reject them without relying on search ranking to rediscover
    // the URL.
    let holdRetryLoadedCount = 0
    let pendingRetryLoadedCount = 0
    if (body.projectId) {
      try {
        const commonFilters = {
          projectId: body.projectId,
          industry: body.industry || body.keywords[0] || '',
          area: areaValidation.normalized,
        }
        const [holdCandidates, pendingCandidates, acceptedCandidates] = await Promise.all([
          getAllSearchCandidates({ ...commonFilters, verificationStatus: 'hold' }),
          // Historical checkpoints were backfilled before an admission
          // decision existed, so they are pending rather than hold.
          getAllSearchCandidates({ ...commonFilters, verificationStatus: 'pending' }),
          getAllSearchCandidates({ ...commonFilters, verificationStatus: 'accepted' }),
        ])
        const alreadyAccepted = new Set(acceptedCandidates.map((candidate) => candidate.normalizedUrl))
        const seen = new Set(items.map((item) => item.link.trim()).filter(Boolean))
        const holdLimit = readBoundedInt(process.env.SERPER_HOLD_RETRY_LIMIT, 1000, 0, 3000)
        const durableCandidates = [...holdCandidates, ...pendingCandidates]
          .filter((candidate, index, all) => all.findIndex(
            (other) => other.normalizedUrl === candidate.normalizedUrl,
          ) === index)
        for (const candidate of durableCandidates.slice(0, holdLimit)) {
          if (!candidate.url || seen.has(candidate.url) || alreadyAccepted.has(candidate.normalizedUrl)) continue
          seen.add(candidate.url)
          items.push({
            link: candidate.url,
            title: candidate.name,
            snippet: '',
            keyword: candidate.keyword,
            area: candidate.area,
            source: candidate.source,
            address: candidate.address,
            phone: candidate.phone,
            category: candidate.category,
            placeId: `hold:${candidate.id}`,
          })
          if (candidate.verificationStatus === 'hold') holdRetryLoadedCount++
          else pendingRetryLoadedCount++
        }
      } catch (error) {
        persistenceWarnings.push(`保留候補の再投入に失敗しました: ${getErrorMessage(error)}`)
      }
    }

    // ── ポータル発見（候補母数の拡大） ─────────────────────
    // ポータル・名簿の掲載事業者を抽出し、公式リンク確認とSerper再検索で
    // 公式HP候補を追加する。公式HPが見つからない事業者は統計上の
    // 「公式HP未発見」として数えるが、通常の企業結果には保存しない。
    let portalStats: PortalDiscoveryStats | undefined
    let hpNotFoundCount = 0
    let hpNotFoundSaved = 0
    let retryLoadedCount = 0
    let retryResolvedCount = 0
    let retryRemainingCount = 0
    const portalDeadline = Math.max(deadline, Date.now() + portalBudgetMs)
    // 本検索が時間予算に達しても、別枠のポータル予算でHot Pepper等を実行する。
    // 途中再開を待たないとポータル層が一度も動かない、という従来の欠落を防ぐ。
    if (portalBudgetMs > 0 && body.includePortals && Date.now() < portalDeadline - 15_000) {
      const existingKeys = new Set(items.map((item) => businessDedupeKey(item.title, item.phone, item.address)))
      const existingUrls = new Set(items.map((item) => item.link.trim()).filter(Boolean))
      const industry = body.industry || body.keywords[0] || ''
      let retryBusinesses: StoredDiscoveredBusiness[] = []
      if (body.projectId && industry) {
        try {
          retryBusinesses = await getRetryableDiscoveredBusinesses({
            projectId: body.projectId,
            industry,
            area: areaValidation.normalized,
            limit: readBoundedInt(process.env.SERPER_PRIOR_UNRESOLVED_LIMIT, 2500, 0, 5000),
            maxAttempts: readBoundedInt(process.env.SERPER_RESOLUTION_MAX_ATTEMPTS, 5, 1, 20),
          })
          retryLoadedCount = retryBusinesses.length
        } catch (error) {
          persistenceWarnings.push(`過去の未解決店舗の読込に失敗しました: ${getErrorMessage(error)}`)
        }
      }
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
        existingUrls,
        enumerateSources: !(checkpoint?.phase === 'complete' && retryBusinesses.length > 0),
        // Previously unresolved businesses are inserted first so the time
        // budget is spent on resumable work before newly discovered rows.
        extraBusinesses: [...retryBusinesses, ...placeBusinesses],
      })
      items.push(...portal.candidates)
      portalStats = portal.stats
      hpNotFoundCount = portal.hpNotFound.length

      if (retryBusinesses.length > 0) {
        const retryById = new Map(retryBusinesses.map((business) => [business.id, business]))
        const attempted = portal.attemptedBusinesses
          .map((business) => business.discoveryId ? retryById.get(business.discoveryId) : undefined)
          .filter((business): business is StoredDiscoveredBusiness => Boolean(business))
        try {
          const retryResult = await recordDiscoveredBusinessAttempts({
            attempted,
            resolved: portal.resolvedBusinesses.map((business) => ({
              discoveryId: business.discoveryId,
              officialUrl: business.officialUrl,
              score: business.resolutionScore,
              evidence: business.resolutionEvidence,
            })),
            maxAttempts: readBoundedInt(process.env.SERPER_RESOLUTION_MAX_ATTEMPTS, 5, 1, 20),
          })
          retryResolvedCount = retryResult.resolved
          retryRemainingCount = retryResult.retry + retryResult.exhausted
        } catch (error) {
          persistenceWarnings.push(`未解決店舗の再検索結果保存に失敗しました: ${getErrorMessage(error)}`)
        }
      }

      if (body.projectId && body.runId && portal.hpNotFound.length > 0) {
        try {
          hpNotFoundSaved = await upsertDiscoveredBusinesses({
            projectId: body.projectId,
            runId: body.runId,
            industry: body.industry || body.keywords[0] || '',
            area: areaValidation.normalized,
            // Rows loaded from an earlier run are updated above; inserting
            // them again under this run would create duplicate retry work.
            businesses: portal.hpNotFound.filter((business) => !business.discoveryId),
          })
        } catch (error) {
          persistenceWarnings.push(`公式HP未発見店舗の保存に失敗しました: ${getErrorMessage(error)}`)
        }
      }

      // 未解決候補は discovered_businesses に保存し、companies には保存しない。
      // portalUrl / Google Maps URL を HP URL として保存すると、結果画面や
      // CSVにまとめサイトそのものが混入するため。公式HPへ解決できた候補
      // だけが items に入り、後段の関連性検証・保存へ進む。
    }

    // Includes candidates resolved from portal listings. Portal/listing URLs
    // themselves never enter items and therefore never enter this table.
    await persistCandidates(items)

    stats.candidateCount = items.length

    // Publish discovery progress before scraping starts. This makes the result
    // count visible immediately and survives a later n8n/callback failure.
    if (body.runId) {
      const run = await getProjectRun(body.runId)
      const canceled = run?.status === 'error' && run.error?.includes('キャンセル')
      if (!canceled && run) {
        try {
          await updateRunStatus(
            body.runId,
            'running',
            run.n8nExecutionId,
            run.itemsWritten,
            { rawSearchCount: items.length },
          )
        } catch (error) {
          persistenceWarnings.push(`候補件数の保存に失敗しました: ${getErrorMessage(error)}`)
        }
      }
    }

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      stats,
      ...(portalStats && { portalStats }),
      hpNotFoundCount,
      hpNotFoundSaved,
      retryLoadedCount,
      retryResolvedCount,
      retryRemainingCount,
      holdRetryLoadedCount,
      pendingRetryLoadedCount,
      errors,
      ...((apiErr || persistenceWarnings.length > 0) && {
        warning: [
          ...(apiErr ? [`一部のSerper検索に失敗しました: ${apiErr.status} ${apiErr.text}`] : []),
          ...new Set(persistenceWarnings),
        ].join(' / '),
      }),
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 400 })
  }
}
