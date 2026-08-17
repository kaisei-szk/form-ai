import { NextRequest, NextResponse } from 'next/server'
import getSupabase from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const { jobId } = params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = getSupabase() as any
    const { data: job, error } = await supabase
      .from('serper_jobs')
      .select('id, status, result_count, result_items, error, created_at, started_at, completed_at')
      .eq('id', jobId)
      .single()

    if (error || !job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 })
    }

    const base = {
      success: true,
      jobId,
      status: job.status as string,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    }

    if (job.status === 'done') {
      const stored = job.result_items
      const payload: { items?: unknown[]; stats?: unknown; warning?: unknown } = stored && !Array.isArray(stored) && typeof stored === 'object'
        ? stored as { items?: unknown[]; stats?: unknown; warning?: unknown }
        : { items: Array.isArray(stored) ? stored : [] }
      const response: Record<string, unknown> = {
        ...base,
        count: job.result_count,
        items: payload.items ?? [],
      }
      if (payload.stats !== undefined) response.stats = payload.stats
      if (payload.warning !== undefined) response.warning = payload.warning
      return NextResponse.json(response)
    }

    if (job.status === 'error') {
      return NextResponse.json({ ...base, error: job.error }, { status: 200 })
    }

    return NextResponse.json(base)
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
