import { NextRequest, NextResponse } from 'next/server'
import { getAllSearchCandidates } from '@/lib/search-candidates-db'
import { getProject, getProjectRun } from '@/lib/project-manager'
import { getErrorMessage } from '@/lib/error-message'

function csvCell(value: string): string {
  // Avoid spreadsheet formula execution while preserving the displayed value.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const projectId = searchParams.get('projectId') || undefined
  const runId = searchParams.get('runId') || undefined
  const runIdsRaw = searchParams.get('runIds')
  const runIds = runIdsRaw ? runIdsRaw.split(',').filter(Boolean) : undefined
  if (!projectId) {
    return NextResponse.json({ success: false, error: 'projectId is required' }, { status: 400 })
  }

  try {
    const candidates = await getAllSearchCandidates({
      projectId,
      runId,
      runIds,
      search: searchParams.get('search') || undefined,
    })
    const lines = [
      ['候補サイト名', 'URL'].map(csvCell).join(','),
      ...candidates.map((candidate) => [candidate.name, candidate.url].map(csvCell).join(',')),
    ]

    let filename = '発見候補'
    if (runId) {
      const run = await getProjectRun(runId)
      if (run) filename = `${run.label}_発見候補`
    } else {
      const project = await getProject(projectId)
      if (project) filename = `${project.name}_発見候補`
    }
    filename = `${filename.replace(/[\s/:]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(`\uFEFF${lines.join('\n')}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 })
  }
}
