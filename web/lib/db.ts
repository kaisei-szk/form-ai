import { createClient } from '@supabase/supabase-js'

let _client: ReturnType<typeof createClient> | null = null

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  const isPlaceholderUrl = !url
    || url.includes('your-project-ref')
    || url.includes('example.')
  const isPlaceholderKey = !key
    || key.includes('your_supabase_')
    || key.includes('placeholder')

  if (isPlaceholderUrl || isPlaceholderKey) return false

  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function getSupabase() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!isSupabaseConfigured() || !url || !key) {
    throw new Error('Supabaseの接続設定が未完了です。.env の SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください。')
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (url, opts) => fetch(url, { ...opts, cache: 'no-store' }) },
  })
  return _client
}

export default getSupabase
