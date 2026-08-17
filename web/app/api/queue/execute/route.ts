import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enqueue, markJobActive, markJobDone } from '@/lib/run-queue'
import {
  addRunToProject,
  addBatchRunToProject,
  getProject,
  rollupBatchRun,
  updateRunStatus,
} from '@/lib/project-manager'
import { triggerWorkflow } from '@/lib/n8n-client'
import { getErrorMessage } from '@/lib/error-message'
import type { ExecuteParams } from '@/lib/types'

const Schema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  label: z.string().min(1),
  industry: z.string().min(1),
  area: z.string().min(1),
  areas: z.array(z.string()).optional(),            // multi-area batch mode
  keywords: z.array(z.string()).optional(),
  maxResults: z.number().int().min(0).optional(),  // 0 = unlimited
  // Radius (map-based) mode
  searchMode: z.enum(['prefecture', 'radius']).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  radiusKm: z.number().min(1).max(200).optional(),
})

/**
 * POST /api/queue/execute
 * キューにジョブを追加し、枠があれば即座にn8nを起動する。
 * 満杯なら待機列に入る。
 *
 * areas が複数の場合 (都道府県モード)、バッチ親ランを1件生成し、
 * 各都道府県ごとに子ランを独立エンキューする。
 * 履歴には親ランだけが表示され、子ランは内部的に隠される。
 */
export async function POST(req: NextRequest) {
  try {
    const body = Schema.parse(await req.json())
    const { runId, projectId, label, ...execFields } = body

    // Verify project exists
    const project = await getProject(projectId)
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 })
    }

    const keywords = execFields.keywords ?? [execFields.industry]
    const maxResults = execFields.maxResults ?? 0
    const base = process.env.INTERNAL_BASE_URL || 'http://localhost:3000'

    const startNextQueuedRun = async (next: Awaited<ReturnType<typeof markJobDone>>) => {
      if (!next) return
      await fetch(`${base}/api/queue/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: next.runId, params: next.params }),
      }).catch(() => {})
    }

    // ── Batch mode: multiple prefectures → 1 parent + N child runs ──────────
    const isBatch = execFields.areas && execFields.areas.length > 1 && execFields.searchMode !== 'radius'

    if (isBatch) {
      const areas = execFields.areas!
      const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }).slice(0, 16)

      // Generate stable child IDs (index-offset to avoid millisecond collisions)
      const now = Date.now()
      const childDefs = areas.map((area, i) => ({
        id: `run-c${now + i}-${Math.random().toString(36).slice(2, 5)}`,
        area,
        label: `${execFields.industry} / ${area} ${timestamp}`,
      }))

      const { children } = await addBatchRunToProject(
        projectId,
        {
          id: runId,
          label,
          searchTarget: {
            industry: execFields.industry,
            area: label,
            areas,
            keywords,
            maxResults,
          },
        },
        childDefs,
      )

      // Enqueue each child independently (respects MAX_CONCURRENT)
      const childResults: {
        id: string
        queued: boolean
        queuePosition: number
        status: 'pending' | 'running' | 'error'
        error?: string
      }[] = []
      let anyChildStarted = false

      for (const child of children) {
        const childParams: ExecuteParams = {
          industry: execFields.industry,
          area: child.searchTarget.area,
          keywords,
          maxResults,
          projectId,
          runId: child.id,
        }

        const { canStart, queuePosition } = await enqueue(child.id, projectId, childParams)

        if (canStart) {
          await markJobActive(child.id)
          try {
            const result = await triggerWorkflow(childParams)
            anyChildStarted = true
            await updateRunStatus(child.id, 'running', result.executionId)
            childResults.push({
              id: child.id,
              queued: false,
              queuePosition: 0,
              status: 'running',
            })
          } catch (triggerErr) {
            const error = getErrorMessage(triggerErr, 'n8nの起動に失敗しました')
            const next = await markJobDone(child.id, 'failed', error)
            await updateRunStatus(child.id, 'error', undefined, 0, {
              completedAt: new Date().toISOString(),
              error,
            })
            await startNextQueuedRun(next)
            childResults.push({
              id: child.id,
              queued: false,
              queuePosition: 0,
              status: 'error',
              error,
            })
          }
        } else {
          childResults.push({
            id: child.id,
            queued: true,
            queuePosition,
            status: 'pending',
          })
        }
      }

      // Promote batch parent to 'running' once at least one child has started
      if (anyChildStarted) {
        await updateRunStatus(runId, 'running')
      } else {
        await rollupBatchRun(runId)
      }

      return NextResponse.json({
        success: true,
        batch: true,
        batchRunId: runId,
        childRunIds: children.map((c) => c.id),
        childResults,
      })
    }

    // ── Single-area (or radius) mode ────────────────────────────────────────
    const params: ExecuteParams = {
      industry: execFields.industry,
      area: execFields.area,
      keywords,
      maxResults,
      projectId,
      runId,
      ...(execFields.searchMode === 'radius' && {
        searchMode: 'radius',
        lat: execFields.lat,
        lng: execFields.lng,
        radiusKm: execFields.radiusKm,
      }),
    }

    // Register run in project (include radius fields so retry can reproduce exact conditions)
    await addRunToProject(projectId, {
      id: runId,
      label,
      searchTarget: {
        industry: execFields.industry,
        area: execFields.area,
        keywords,
        maxResults,
        ...(execFields.searchMode === 'radius' && {
          searchMode: 'radius' as const,
          lat: execFields.lat,
          lng: execFields.lng,
          radiusKm: execFields.radiusKm,
        }),
      },
    })

    // Enqueue (file-based)
    const { canStart, queuePosition } = await enqueue(runId, projectId, params)

    if (!canStart) {
      return NextResponse.json({
        success: true,
        queued: true,
        queuePosition,
        message: `キュー待機中 (${queuePosition}番目)`,
      })
    }

    // Start immediately
    await markJobActive(runId)

    try {
      const result = await triggerWorkflow(params)
      // Update run status to running
      await updateRunStatus(runId, 'running', result.executionId)

      return NextResponse.json({
        success: true,
        queued: false,
        executionId: result.executionId,
      })
    } catch (triggerErr) {
      // Trigger failed — mark queue job as failed so it doesn't block the queue
      const error = getErrorMessage(triggerErr, 'n8nの起動に失敗しました')
      const next = await markJobDone(runId, 'failed', error)
      await updateRunStatus(runId, 'error', undefined, 0, {
        completedAt: new Date().toISOString(),
        error,
      })
      await startNextQueuedRun(next)
      throw triggerErr
    }
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 400 })
  }
}
