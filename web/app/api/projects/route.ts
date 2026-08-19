import { NextRequest, NextResponse } from 'next/server'
import { getProjects, createProject, getAllProjectRuns } from '@/lib/project-manager'
import { getProjectsStats } from '@/lib/companies-db'
import { getErrorMessage, isMissingDatabaseSchemaError } from '@/lib/error-message'
import { isSupabaseConfigured } from '@/lib/db'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: true, data: [], localMode: true })
  }

  try {
    const projects = await getProjects()
    const [statsMap, runs] = await Promise.all([
      getProjectsStats(projects.map((p) => p.id)),
      getAllProjectRuns(),
    ])
    const runCounts = new Map<string, number>()
    for (const run of runs) {
      runCounts.set(run.projectId, (runCounts.get(run.projectId) ?? 0) + 1)
    }
    const data = projects.map((p) => {
      const stats = statsMap.get(p.id)
      return {
        ...p,
        runCount: runCounts.get(p.id) ?? 0,
        companyCount: stats?.companyCount ?? 0,
        formFoundCount: stats?.formFoundCount ?? 0,
      }
    })
    return NextResponse.json({ success: true, data })
  } catch (e) {
    if (isMissingDatabaseSchemaError(e)) {
      return NextResponse.json({ success: true, data: [], setupRequired: true })
    }
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 })
  }
}

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = CreateSchema.parse(await req.json())
    const project = await createProject(body.name, body.description)
    return NextResponse.json({ success: true, data: project })
  } catch (e) {
    if (isMissingDatabaseSchemaError(e)) {
      return NextResponse.json(
        { success: false, error: 'Supabaseの初期化が必要です。supabase/schema.sqlをSQL Editorで実行してください。' },
        { status: 503 },
      )
    }
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 400 })
  }
}
