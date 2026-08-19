import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getProjectRun, updateRunStatus } from '@/lib/project-manager'
import { getErrorMessage } from '@/lib/error-message'

const Schema = z.object({
  n8nExecutionId: z.union([z.string(), z.number()]).transform(String),
}).passthrough()

/**
 * Record the n8n execution id before the expensive search starts. The response
 * echoes the original parameters so this node can sit inline between the n8n
 * parameter node and the Serper request without losing any search input.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const body = Schema.parse(await req.json())
    const run = await getProjectRun(params.runId)
    if (!run) {
      return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 })
    }

    if (run.status === 'error' && run.error?.includes('キャンセル')) {
      return NextResponse.json({ ...body, ignored: true, reason: 'run_canceled' })
    }

    await updateRunStatus(params.runId, 'running', body.n8nExecutionId)
    return NextResponse.json(body)
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 400 })
  }
}
