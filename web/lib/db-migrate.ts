import getSql from './db'

export async function runMigrations(): Promise<void> {
  // Supabase's Data API cannot execute DDL. Verify that dashboard/CLI migrations
  // have been applied instead of returning a misleading success response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const requiredTables = ['projects', 'project_runs', 'companies', 'presets', 'queue_jobs', 'app_settings']
  const missing: string[] = []

  for (const table of requiredTables) {
    const { error } = await supabase.from(table).select('*', { count: 'exact', head: true })
    if (error) missing.push(table)
  }
  if (missing.length > 0) {
    throw new Error(`Supabase migration required for: ${missing.join(', ')}`)
  }
}
