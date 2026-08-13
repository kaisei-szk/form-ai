import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { triggerWorkflow } from '@/lib/n8n-client'
import { getProjectRun, rollupBatchRun, updateRunStatus } from '@/lib/project-manager'
import { getJobByRunId, markJobDone } from '@/lib/run-queue'
import { getErrorMessage } from '@/lib/error-message'
import type { ExecuteParams } from '@/lib/types'

const Schema = z.object({
  runId: z.string(),
  params: z.object({
    industry: z.string(),
    area: z.string(),
    areas: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
    suffixes: z.array(z.string()).optional(),
    maxResults: z.number().optional(),
    searchProvider: z.enum(['serper', 'places']).optional(),
    projectId: z.string(),
    runId: z.string(),
    searchMode: z.enum(['prefecture', 'radius']).optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    radiusKm: z.number().optional(),
  }),
})

/**
 * POST /api/queue/start
 * キューから次のジョブを実際にn8nで起動する（内部用）。
 */
export async function POST(req: NextRequest) {
  try {
    const { runId, params } = Schema.parse(await req.json())
    const execParams = params as ExecuteParams

    // A waiting job may be canceled after it is selected but before this
    // internal request arrives. Never start a job that is no longer active.
    const job = await getJobByRunId(runId)
    if (!job || job.status !== 'active') {
      return NextResponse.json({ success: true, ignored: true, reason: 'job_not_active' })
    }

    try {
      const result = await triggerWorkflow(execParams)
      await updateRunStatus(runId, 'running', result.executionId)
      const run = await getProjectRun(runId)
      if (run?.parentRunId) await updateRunStatus(run.parentRunId, 'running')
      return NextResponse.json({ success: true, executionId: result.executionId })
    } catch (triggerErr) {
      // Trigger failed — mark both run and queue job as failed
      const error = getErrorMessage(triggerErr, 'n8nの起動に失敗しました')
      await updateRunStatus(runId, 'error', undefined, 0, {
        completedAt: new Date().toISOString(),
        error,
      })
      const failedRun = await getProjectRun(runId)
      if (failedRun?.parentRunId) await rollupBatchRun(failedRun.parentRunId)
      const next = await markJobDone(runId, 'failed', error)
      if (next) {
        const base = process.env.INTERNAL_BASE_URL || 'http://localhost:3000'
        fetch(`${base}/api/queue/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: next.runId, params: next.params }),
        }).catch(() => {})
      }
      return NextResponse.json({ success: false, error }, { status: 502 })
    }
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 400 })
  }
}
