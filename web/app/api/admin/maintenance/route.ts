import { NextRequest, NextResponse } from 'next/server'
import { runMaintenance, pruneOldData } from '@/lib/db-maintenance'
import { expireStaleRuns } from '@/lib/project-manager'
import { requireInternalAuth } from '@/lib/internal-auth'
import { z } from 'zod'

const MaintenanceSchema = z.object({
  prune: z.boolean().optional(),
  daysOld: z.number().int().min(7).max(3650).optional(),
  statuses: z.array(z.enum(['送信済み', 'スキップ'])).max(2).optional(),
})

/**
 * POST /api/admin/maintenance
 * Runs DB housekeeping: WAL checkpoint, VACUUM, stale-run expiry.
 * Optionally prunes old completed-job rows.
 *
 * Body (all optional):
 *   { prune?: boolean, daysOld?: number, statuses?: string[] }
 *
 * Called by n8n on a schedule or manually from the settings page.
 * Requires INTERNAL_API_SECRET via x-internal-api-key or Bearer auth.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized
  try {
    let rawBody: unknown = {}
    try { rawBody = await req.json() } catch { /* no body or non-JSON */ }
    const parsed = MaintenanceSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
    }
    const pruneOpts = parsed.data

    const staleExpired = await expireStaleRuns()
    const dbStats = await runMaintenance()

    let prunedRows = 0
    if (pruneOpts.prune) {
      prunedRows = await pruneOldData({
        daysOld: pruneOpts.daysOld,
        statuses: pruneOpts.statuses,
      })
    }

    return NextResponse.json({
      success: true,
      staleRunsExpired: staleExpired,
      prunedRows,
      ...dbStats,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized
  try {
    const staleExpired = await expireStaleRuns()
    const dbStats = await runMaintenance()
    return NextResponse.json({ success: true, staleRunsExpired: staleExpired, ...dbStats })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
