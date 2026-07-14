import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import type { SearchConfig, SearchRun } from './types'
import getSql from './db'
import bundledConfig from '../../config/search-params.json'

const CONFIG_DIR = process.env.CONFIG_DIR || path.resolve(process.cwd(), '../config')

function getConfigPath() {
  return path.join(CONFIG_DIR, 'search-params.json')
}

const SETTINGS_KEY = 'search_config'

function getFileConfig(): SearchConfig {
  const raw = fs.readFileSync(getConfigPath(), 'utf-8')
  return JSON.parse(raw) as SearchConfig
}

export async function getConfig(): Promise<SearchConfig> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).limit(1)
  if (!error && data?.length) return data[0].value as SearchConfig
  if (error && process.env.NODE_ENV === 'production') throw error

  const fallback = process.env.NODE_ENV === 'production'
    ? JSON.parse(JSON.stringify(bundledConfig)) as SearchConfig
    : getFileConfig()
  const { error: seedError } = await supabase.from('app_settings').upsert({
    key: SETTINGS_KEY,
    value: fallback,
    updated_at: new Date().toISOString(),
  })
  if (seedError && process.env.NODE_ENV === 'production') throw seedError
  return fallback
}

const SearchTargetSchema = z.object({
  industry: z.string().min(1),
  area: z.string().min(1),
  keywords: z.array(z.string()),
  maxResults: z.number().int().min(1).max(200),
})

const SearchRunSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  label: z.string(),
  searchTargets: z.array(SearchTargetSchema),
})

const ConfigSchema = z.object({
  _comment: z.string().optional(),
  runs: z.array(SearchRunSchema),
  areaExpansion: z.record(z.array(z.string())),
  formDetection: z.any().optional(),
  sheetsColumns: z.any().optional(),
})

export async function updateConfig(config: SearchConfig): Promise<void> {
  ConfigSchema.parse(config)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { error } = await supabase.from('app_settings').upsert({
    key: SETTINGS_KEY,
    value: config,
    updated_at: new Date().toISOString(),
  })
  if (!error) return
  if (process.env.NODE_ENV === 'production') throw error

  const tmp = getConfigPath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2))
  fs.renameSync(tmp, getConfigPath())
}

export async function addRun(run: Omit<SearchRun, 'id'>): Promise<SearchRun> {
  const config = await getConfig()
  const maxId = config.runs.reduce((m, r) => {
    const n = parseInt(r.id.replace('run-', ''), 10)
    return isNaN(n) ? m : Math.max(m, n)
  }, 0)
  const newRun: SearchRun = { ...run, id: `run-${String(maxId + 1).padStart(3, '0')}` }
  config.runs.push(newRun)
  await updateConfig(config)
  return newRun
}

export async function removeRun(id: string): Promise<void> {
  const config = await getConfig()
  config.runs = config.runs.filter((r) => r.id !== id)
  await updateConfig(config)
}

export async function toggleRun(id: string): Promise<boolean> {
  const config = await getConfig()
  const run = config.runs.find((r) => r.id === id)
  if (!run) throw new Error(`Run ${id} not found`)
  run.enabled = !run.enabled
  await updateConfig(config)
  return run.enabled
}
