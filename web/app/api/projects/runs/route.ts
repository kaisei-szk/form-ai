import { NextResponse } from 'next/server'
import { getProjects, getAllProjectRuns } from '@/lib/project-manager'
import { getErrorMessage, isMissingDatabaseSchemaError } from '@/lib/error-message'
import { isSupabaseConfigured } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** GET /api/projects/runs — 全プロジェクトの全ランを新しい順で返す */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: true, data: [], localMode: true })
  }

  try {
    const [projects, projectRuns] = await Promise.all([
      getProjects(),
      getAllProjectRuns(),
    ])
    const projectMap: Record<string, { id: string; name: string }> = {}
    for (const p of projects) projectMap[p.id] = { id: p.id, name: p.name }

    const allRuns = projectRuns
      // Hide child runs — they belong to a batch parent and should not appear in history
      .filter((r) => !r.parentRunId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const data = allRuns.map((r) => ({
      ...r,
      projectName: projectMap[r.projectId]?.name ?? r.projectId,
    }))

    return NextResponse.json({ success: true, data })
  } catch (e) {
    if (isMissingDatabaseSchemaError(e)) {
      return NextResponse.json({ success: true, data: [], setupRequired: true })
    }
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 })
  }
}
