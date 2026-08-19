import { NextRequest, NextResponse } from 'next/server'
import { getProject, deleteProject, getRunsForProject } from '@/lib/project-manager'
import { getCompanyStats } from '@/lib/companies-db'
import { getErrorMessage } from '@/lib/error-message'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [project, projectRuns, stats] = await Promise.all([
      getProject(params.id),
      getRunsForProject(params.id),
      getCompanyStats(params.id),
    ])
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    // Exclude child runs (parentRunId set) — they are internal and shown only via their batch parent
    const runs = projectRuns.filter((r) => !r.parentRunId)
    return NextResponse.json({ success: true, data: { ...project, runs, totalCount: stats.total, formFoundCount: stats.formFoundCount } })
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteProject(params.id)
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 })
  }
}
