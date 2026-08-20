import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { triggerWorkflow } from '@/lib/n8n-client'
import { getProjectRun } from '@/lib/project-manager'

const Schema = z.object({
  industry: z.string().min(1),
  area: z.string().min(1),
  keywords: z.array(z.string()).optional(),
  maxResults: z.number().int().min(0).optional(), // 0 = unlimited
  projectId: z.string().min(1),
  runId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const params = Schema.parse(body)
    const result = await triggerWorkflow(params, {
      getRegisteredExecutionId: async () => (await getProjectRun(params.runId))?.n8nExecutionId,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: msg }, { status: 400 })
  }
}
