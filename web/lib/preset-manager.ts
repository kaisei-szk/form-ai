import getSql from './db'
import type { Preset, SearchTarget } from './types'

function rowToPreset(r: Record<string, unknown>): Preset {
  return {
    id:           r.id as string,
    name:         r.name as string,
    createdAt:    r.created_at as string,
    searchTarget: r.search_target as SearchTarget,
  }
}

export async function getPresets(): Promise<Preset[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase.from('presets').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToPreset)
}

export async function savePreset(name: string, searchTarget: SearchTarget): Promise<Preset> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase
    .from('presets')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const maxId = data && data.length > 0
    ? parseInt((data[0].id as string).replace('preset-', ''), 10) || 0
    : 0
  const id = `preset-${String(maxId + 1).padStart(3, '0')}`
  const createdAt = new Date().toISOString()
  const { error: insertError } = await supabase
    .from('presets')
    .insert({ id, name, created_at: createdAt, search_target: searchTarget })
  if (insertError) throw insertError
  return { id, name, createdAt, searchTarget }
}

export async function deletePreset(id: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { error } = await supabase.from('presets').delete().eq('id', id)
  if (error) throw error
}

export async function getPreset(id: string): Promise<Preset | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase.from('presets').select('*').eq('id', id).limit(1)
  if (error) throw error
  return data && data.length > 0 ? rowToPreset(data[0]) : undefined
}
