import { NextResponse } from 'next/server'
import { syncAllRunningJobs } from '@/lib/n8n-sync'
import { getErrorMessage, isMissingDatabaseSchemaError } from '@/lib/error-message'
import { isSupabaseConfigured } from '@/lib/db'

/**
 * POST /api/projects/runs/sync
 * 全実行中ランのステータスをn8nから同期する。
 * ページ読み込み時や定期ポーリングから呼ばれる。
 */
export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: true, synced: 0, localMode: true })
  }

  try {
    const result = await syncAllRunningJobs()
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    if (isMissingDatabaseSchemaError(e)) {
      return NextResponse.json({ success: true, synced: 0, setupRequired: true })
    }
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 })
  }
}
