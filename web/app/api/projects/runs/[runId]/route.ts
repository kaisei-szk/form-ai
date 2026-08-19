import { NextRequest, NextResponse } from 'next/server'
import { getProjectRun, updateRunStatus, deleteRun } from '@/lib/project-manager'
import { getJobByRunId, getQueuePosition, markJobDone } from '@/lib/run-queue'
import { findExecutionByRunId } from '@/lib/n8n-client'
import { syncRun } from '@/lib/n8n-sync'
import { removeByRunId } from '@/lib/companies-db'
import { getErrorMessage } from '@/lib/error-message'
import { z } from 'zod'

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  try {
    let run = await getProjectRun(params.runId)
    if (!run) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

    // Completion callback前にn8nが失敗した場合も、個別ポーリングだけで
    // runningのまま残らないよう実行IDと最終状態を照合する。
    if (run.status === 'pending' || run.status === 'running') {
      try {
        const job = await getJobByRunId(params.runId)
        if (job?.status === 'failed') {
          await updateRunStatus(params.runId, 'error', run.n8nExecutionId, run.itemsWritten, {
            completedAt: job.completedAt ?? new Date().toISOString(),
            error: job.error ?? 'キュージョブの開始に失敗しました',
          })
        } else {
          const executionId = run.n8nExecutionId
            ?? (await findExecutionByRunId(params.runId))?.id
          if (executionId) {
            if (!run.n8nExecutionId) await updateRunStatus(params.runId, 'running', executionId)
            await syncRun(params.runId, executionId)
          }
        }
        run = await getProjectRun(params.runId) ?? run
      } catch {
        // n8nの一時的な通信エラーではDBにある直近状態を返す。
      }
    }

    // Attach live queue position so the execute panel can show correct status
    const queuePosition = (run.status === 'pending' || run.status === 'running')
      ? await getQueuePosition(params.runId)
      : 0
    return NextResponse.json({ success: true, data: { ...run, queuePosition } })
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 })
  }
}

const PatchSchema = z.object({
  status: z.enum(['pending', 'running', 'success', 'error']),
  n8nExecutionId: z.string().optional(),
  itemsWritten: z.number().int().optional(),
  tokensInput: z.number().int().optional(),
  tokensOutput: z.number().int().optional(),
  estimatedCostUsd: z.number().optional(),
  completedAt: z.string().optional(),
  rawSearchCount: z.number().int().optional(),
  error: z.string().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { runId: string } }) {
  try {
    const body = PatchSchema.parse(await req.json())
    await updateRunStatus(params.runId, body.status, body.n8nExecutionId, body.itemsWritten, {
      tokensInput: body.tokensInput,
      tokensOutput: body.tokensOutput,
      estimatedCostUsd: body.estimatedCostUsd,
      completedAt: body.completedAt,
      rawSearchCount: body.rawSearchCount,
      error: body.status === 'error' ? (body.error ?? 'ユーザーによりキャンセルされました') : undefined,
    })

    // When a run is manually canceled (set to 'error'), advance the queue so waiting
    // jobs are not blocked. markJobDone is idempotent — safe to call even if n8n also
    // completes the job afterwards.
    if (body.status === 'error') {
      const next = await markJobDone(params.runId, 'failed', 'canceled_by_user')
      if (next) {
        const base = process.env.INTERNAL_BASE_URL || 'http://localhost:3000'
        fetch(`${base}/api/queue/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: next.runId, params: next.params }),
        }).catch(() => {})
      }
    }

    const run = await getProjectRun(params.runId)
    return NextResponse.json({ success: true, data: run })
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 400 })
  }
}

/**
 * DELETE /api/projects/runs/[runId]
 * Removes the run record and all associated company rows.
 * Only allowed for completed (success/error) runs.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { runId: string } }) {
  try {
    const run = await getProjectRun(params.runId)
    if (!run) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    if (run.status === 'running' || run.status === 'pending') {
      return NextResponse.json({ success: false, error: '実行中のランは削除できません。先にキャンセルしてください。' }, { status: 409 })
    }
    const companiesRemoved = await removeByRunId(params.runId)
    await deleteRun(params.runId)
    return NextResponse.json({ success: true, companiesRemoved })
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 })
  }
}
