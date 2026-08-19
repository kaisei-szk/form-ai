import { NextRequest, NextResponse } from 'next/server'
import { getPresets, savePreset, deletePreset } from '@/lib/preset-manager'
import { getErrorMessage, isMissingDatabaseSchemaError } from '@/lib/error-message'
import { isSupabaseConfigured } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: true, data: [], localMode: true })
  }

  try {
    const presets = await getPresets()
    return NextResponse.json({ success: true, data: presets })
  } catch (e) {
    if (isMissingDatabaseSchemaError(e)) {
      return NextResponse.json({ success: true, data: [], setupRequired: true })
    }
    return NextResponse.json({ success: false, error: getErrorMessage(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, searchTarget } = await req.json()
    if (!name || !searchTarget) {
      return NextResponse.json({ success: false, error: 'name and searchTarget required' }, { status: 400 })
    }
    const preset = await savePreset(name, searchTarget)
    return NextResponse.json({ success: true, data: preset })
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

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })
    await deletePreset(id)
    return NextResponse.json({ success: true })
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
