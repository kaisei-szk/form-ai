import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateRunStatus, getProjectRun, getRunSearchCheckpoint, rollupBatchRun } from '@/lib/project-manager'
import { markJobDone, isQueueIdle } from '@/lib/run-queue'
import { calcCostUsd } from '@/lib/n8n-sync'
import { countCompanies, upsertRunCompanies } from '@/lib/companies-db'
import { getErrorMessage } from '@/lib/error-message'
import type { CompanyInput } from '@/lib/companies-db'

const ResultsSchema = z.object({
  totalCompanies: z.number().int().min(0).optional(),
  afterDedup:     z.number().int().min(0).optional(),
  successCount:   z.number().int().min(0).optional(),
  errorCount:     z.number().int().min(0).optional(),
  formFoundCount: z.number().int().min(0).optional(),
  formFoundRate:  z.number().int().min(0).optional(),
  itemsWritten:   z.number().int().min(0).optional(),
  elapsedMs:      z.number().int().min(0).optional(),
  avgMsPerItem:   z.number().int().min(0).optional(),
  subAreaCount:   z.number().int().min(0).optional(),
  queryCount:     z.number().int().min(0).optional(),
  relevanceRejectedCount: z.number().int().min(0).optional(),
  searchFailedQueries: z.number().int().min(0).optional(),
  areaRejectedCount: z.number().int().min(0).optional(),
  blockedDomainCount: z.number().int().min(0).optional(),
  duplicateCandidateCount: z.number().int().min(0).optional(),
  rawCandidateCount: z.number().int().min(0).optional(),
  uniquePlaceCount: z.number().int().min(0).optional(),
  noWebsiteCount: z.number().int().min(0).optional(),
  paginationRepeatCount: z.number().int().min(0).optional(),
  exhaustedQueryCount: z.number().int().min(0).optional(),
  pageCapReachedQueryCount: z.number().int().min(0).optional(),
  maxPages: z.number().int().min(1).optional(),
  hpFetchFailureCount: z.number().int().min(0).optional(),
  placesCandidateCount: z.number().int().min(0).optional(),
  organicCandidateCount: z.number().int().min(0).optional(),
  organicRawCandidateCount: z.number().int().min(0).optional(),
  organicRejectedCount: z.number().int().min(0).optional(),
  organicQueriesExecuted: z.number().int().min(0).optional(),
  organicFailedQueries: z.number().int().min(0).optional(),
  organicExhaustedQueryCount: z.number().int().min(0).optional(),
  organicPageCapReachedQueryCount: z.number().int().min(0).optional(),
  organicMaxPages: z.number().int().min(0).optional(),
  searchTimeBudgetReached: z.boolean().optional(),
  searchElapsedMs: z.number().int().min(0).optional(),
  relevanceReasonCounts: z.record(z.number().int().min(0)).optional(),
  relevanceAcceptedCount: z.number().int().min(0).optional(),
  relevanceHoldCount: z.number().int().min(0).optional(),
  portalQueriesExecuted: z.number().int().min(0).optional(),
  portalFailedQueries: z.number().int().min(0).optional(),
  portalDiscoveryOrganicResults: z.number().int().min(0).optional(),
  portalListingPagesFound: z.number().int().min(0).optional(),
  portalListingPagesFetched: z.number().int().min(0).optional(),
  portalDetailPagesFetched: z.number().int().min(0).optional(),
  portalBusinessesExtracted: z.number().int().min(0).optional(),
  portalDedupedBusinessCount: z.number().int().min(0).optional(),
  portalOfficialLinkCount: z.number().int().min(0).optional(),
  portalOfficialFoundByResearch: z.number().int().min(0).optional(),
  portalResearchQueriesExecuted: z.number().int().min(0).optional(),
  portalFetchFailedCount: z.number().int().min(0).optional(),
  portalDeadlineReached: z.boolean().optional(),
  hpNotFoundCount: z.number().int().min(0).optional(),
  hpNotFoundSaved: z.number().int().min(0).optional(),
  expectedCandidateCount: z.number().int().min(0).optional(),
  processedCandidateCount: z.number().int().min(0).optional(),
  pendingCandidateCount: z.number().int().min(0).optional(),
  batchCount: z.number().int().min(0).optional(),
  completedBatchCount: z.number().int().min(0).optional(),
  failedBatchCount: z.number().int().min(0).optional(),
  resultSetComplete: z.boolean().optional(),
  // Diagnostic text is part of the execution record. Never reject the entire
  // result set merely because an upstream stack trace exceeds a display limit.
  warnings: z.array(z.string()).optional(),
}).optional()

// Strict company schema — reject malformed records before DB insert
const CompanySchema = z.object({
  name:        z.string().default(''),
  hpUrl:       z.string().default(''),
  formUrl:     z.string().default(''),
  phone:       z.string().optional(),
  email:       z.string().optional(),
  address:     z.string().optional(),
  industry:    z.string().optional(),
  area:        z.string().optional(),
  formType:    z.string().optional(),
  status:      z.string().optional(),
  notes:       z.string().optional(),
  projectId:   z.string().optional(),
  runId:       z.string().optional(),
  collectedAt: z.string().optional(),
})

const Schema = z.object({
  status:       z.enum(['success', 'error']),
  itemsWritten: z.number().int().min(0).optional(),
  tokensInput:  z.number().int().min(0).optional(),
  tokensOutput: z.number().int().min(0).optional(),
  model:        z.string().optional(),
  error:        z.string().optional(),
  results:      ResultsSchema,
  companies:    z.array(z.unknown()).optional(),  // validated individually below
})

/**
 * POST /api/projects/runs/[runId]/complete
 * n8n ワークフローの最終ノードから呼ばれるコールバック。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const body = Schema.parse(await req.json())
    const { runId } = params
    const existingRun = await getProjectRun(runId)

    // キャンセル後にn8nが遅れてコールバックしても、成功状態への巻き戻しや
    // データ追加を行わない。
    if (
      existingRun?.status === 'error'
      && existingRun.error?.includes('キャンセル')
    ) {
      return NextResponse.json({ success: true, ignored: true, reason: 'run_canceled' })
    }

    // コスト計算: Serper + OpenAI LLM。Serperの契約単価はプランで
    // 異なるため、SERPER_COST_PER_QUERY_USD が明示された場合だけ加算する。
    // OpenAI GPT: tokensInput/tokensOutput から calcCostUsd で計算
    const SERPER_COST_PER_QUERY = Number(process.env.SERPER_COST_PER_QUERY_USD || '0')
    let gptCostUsd = 0
    let searchCostUsd = 0
    if (body.tokensInput !== undefined && body.tokensOutput !== undefined) {
      gptCostUsd = calcCostUsd(body.model ?? 'gpt-4o-mini', body.tokensInput, body.tokensOutput)
    }
    const queryCount = body.results?.queryCount ?? body.results?.subAreaCount
    if (queryCount !== undefined && queryCount > 0) {
      searchCostUsd = queryCount * SERPER_COST_PER_QUERY
    }
    const totalCost = gptCostUsd + searchCostUsd
    const estimatedCostUsd = totalCost > 0 ? totalCost : undefined

    // Validate and filter company records
    let actualSaved = 0
    if (body.companies?.length) {
      const validCompanies: CompanyInput[] = []
      for (const raw of body.companies) {
        const parsed = CompanySchema.safeParse(raw)
        if (!parsed.success) continue
        const c = parsed.data
        // Skip records with neither a name nor an HP URL
        if (!c.name && !c.hpUrl) continue
        validCompanies.push(c as CompanyInput)
      }
      if (validCompanies.length > 0) {
        const { saved } = await upsertRunCompanies(validCompanies)
        actualSaved = saved
      }
    }

    // Results are persisted by each scrape batch, so the DB count is always the
    // authority even though the final callback intentionally carries no company
    // payload. A callback failure can no longer erase already collected rows.
    const dbRunCount = await countCompanies({ runId })
    const itemsWritten = dbRunCount > 0 ? dbRunCount : (body.itemsWritten ?? body.results?.itemsWritten ?? 0)

    const expectedCandidateCount = body.results?.expectedCandidateCount
      ?? body.results?.totalCompanies
      ?? 0
    const processedCandidateCount = body.results?.processedCandidateCount
      ?? (
        (body.results?.afterDedup ?? 0)
        + (body.results?.relevanceHoldCount ?? 0)
        + (body.results?.relevanceRejectedCount ?? 0)
      )
    const pendingCandidateCount = body.results?.pendingCandidateCount
      ?? Math.max(0, expectedCandidateCount - processedCandidateCount)
    const resultSetComplete = body.results?.resultSetComplete
      ?? pendingCandidateCount === 0
    const discoveryIncomplete = body.results?.searchTimeBudgetReached === true
      || body.results?.portalDeadlineReached === true
    const normalizedResults = body.results ? {
      ...body.results,
      itemsWritten,
      expectedCandidateCount,
      processedCandidateCount,
      pendingCandidateCount,
      resultSetComplete,
      ...(existingRun?.results?.searchProgress ? {
        searchProgress: {
          ...existingRun.results.searchProgress,
          resumeAvailable: discoveryIncomplete,
        },
      } : {}),
    } : undefined
    const preservedCheckpoint = discoveryIncomplete
      ? await getRunSearchCheckpoint(runId)
      : undefined

    const incompleteResultSet = body.status === 'success' && !resultSetComplete
    const finalStatus = incompleteResultSet || discoveryIncomplete ? 'error' : body.status
    const finalError = discoveryIncomplete
      ? '検索の時間予算に到達しました。途中結果と再開位置を保存済みです。「続きから再開」で処理を継続できます。'
      : incompleteResultSet
      ? `結果の完全性を確認できませんでした: ${processedCandidateCount}/${expectedCandidateCount}件処理済み、未処理${pendingCandidateCount}件、失敗バッチ${body.results?.failedBatchCount ?? 0}件`
      : body.error

    await updateRunStatus(runId, finalStatus, undefined, itemsWritten, {
      tokensInput: body.tokensInput,
      tokensOutput: body.tokensOutput,
      estimatedCostUsd,
      rawSearchCount: body.results?.totalCompanies,
      completedAt: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results: normalizedResults as any,
      searchCheckpoint: preservedCheckpoint,
      error: finalStatus === 'error' ? (finalError ?? 'Unknown error') : undefined,
    })

    // If this is a child run, roll up stats into the batch parent (idempotent once all done)
    const completedRun = await getProjectRun(runId)
    if (completedRun?.parentRunId) {
      await rollupBatchRun(completedRun.parentRunId)
    }

    // Trigger next queued job
    const next = await markJobDone(runId, finalStatus === 'success' ? 'completed' : 'failed', finalError)
    const base = process.env.INTERNAL_BASE_URL || 'http://localhost:3000'
    if (next) {
      fetch(`${base}/api/queue/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: next.runId, params: next.params }),
      }).catch(() => {})
    } else if (await isQueueIdle()) {
      // Queue is fully drained — run DB housekeeping in the background (non-blocking).
      // Also prune rows older than 90 days that are in terminal statuses (送信済み, スキップ)
      // to keep the DB lean without manual intervention.
      fetch(`${base}/api/admin/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prune: true, daysOld: 90 }),
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, itemsWritten, saved: actualSaved, status: finalStatus })
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 400 })
  }
}
