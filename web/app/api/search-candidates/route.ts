import { NextRequest, NextResponse } from 'next/server'
import { getSearchCandidates, upsertSearchCandidates } from '@/lib/search-candidates-db'
import { getErrorMessage, isMissingDatabaseSchemaError } from '@/lib/error-message'
import { getProjectRun, getRunsForProject, getRunSearchCheckpoint } from '@/lib/project-manager'
import type { ProjectRun } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const projectId = searchParams.get('projectId') || undefined
  const runId = searchParams.get('runId') || undefined
  const runIdsRaw = searchParams.get('runIds')
  const runIds = runIdsRaw ? runIdsRaw.split(',').filter(Boolean) : undefined
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(500, Math.max(1, Number.parseInt(searchParams.get('limit') || '100', 10)))

  if (!projectId) {
    return NextResponse.json({ success: false, error: 'projectId is required' }, { status: 400 })
  }

  try {
    const filters = {
      projectId,
      runId,
      runIds,
      search: searchParams.get('search') || undefined,
      verificationStatus: (searchParams.get('verificationStatus') || undefined) as
        | 'pending' | 'accepted' | 'hold' | 'rejected' | undefined,
      limit,
      offset: (page - 1) * limit,
    }
    let result = await getSearchCandidates(filters)

    // Best-effort backfill for runs created before search_candidates existed.
    // Only checkpoints that still contain candidate details can be recovered;
    // a historical count alone cannot reconstruct names and URLs.
    if (result.total === 0 && !filters.search) {
      const runs: ProjectRun[] = runId
        ? []
        : runIds?.length
          ? (await Promise.all(runIds.map((id) => getProjectRun(id))))
              .filter((run): run is ProjectRun => run !== undefined && run.projectId === projectId)
          : await getRunsForProject(projectId)
      if (runId) {
        const run = await getProjectRun(runId)
        if (run?.projectId === projectId) runs.push(run)
      }
      for (const run of runs) {
        const checkpoint = await getRunSearchCheckpoint(run.id)
        if (checkpoint?.items?.length) {
          await upsertSearchCandidates({
            projectId,
            runId: run.id,
            candidates: checkpoint.items,
            industry: run.searchTarget.industry,
          })
        }
      }
      result = await getSearchCandidates(filters)
    }
    return NextResponse.json({
      success: true,
      data: result.candidates,
      total: result.total,
      page,
      limit,
    })
  } catch (error) {
    if (isMissingDatabaseSchemaError(error)) {
      return NextResponse.json({
        success: true,
        data: [],
        total: 0,
        page,
        limit,
        setupRequired: true,
      })
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 })
  }
}
