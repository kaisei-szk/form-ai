import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import type { Credentials } from 'google-auth-library'
import getSql from './db'

const CONFIG_DIR = process.env.CONFIG_DIR || path.resolve(process.cwd(), '../config')
const TOKEN_PATH = path.join(CONFIG_DIR, 'oauth2-token.json')
const CREDS_PATH = path.join(CONFIG_DIR, 'oauth2-credentials.json')
const TOKEN_KEY = 'google_oauth_token'

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
]

function getRedirectUri() {
  const base = process.env.INTERNAL_BASE_URL || 'http://localhost:3000'
  return `${base}/api/google/callback`
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    }
  }
  if (!fs.existsSync(CREDS_PATH)) {
    throw new Error('Google OAuth credentials are not configured')
  }
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'))
  const values = creds.installed || creds.web
  return { clientId: values.client_id, clientSecret: values.client_secret }
}

export function getOAuth2Client() {
  const { clientId, clientSecret } = getClientCredentials()
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri())
}

export function getAuthUrl(state?: string): string {
  const client = getOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state,
  })
}

async function loadToken(): Promise<Credentials | null> {
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return { refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', TOKEN_KEY).limit(1)
  if (!error && data?.length) return data[0].value as Credentials
  if (error && process.env.NODE_ENV === 'production') throw error

  if (!fs.existsSync(TOKEN_PATH)) return null
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')) as Credentials
}

async function saveToken(token: Credentials): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getSql() as any
  const { error } = await supabase.from('app_settings').upsert({
    key: TOKEN_KEY,
    value: token,
    updated_at: new Date().toISOString(),
  })
  if (!error) return
  if (process.env.NODE_ENV === 'production') throw error

  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2))
}

export async function hasToken(): Promise<boolean> {
  try {
    const token = await loadToken()
    return Boolean(token?.access_token || token?.refresh_token)
  } catch {
    return false
  }
}

export async function getAuthedClient() {
  const token = await loadToken()
  if (!token?.access_token && !token?.refresh_token) throw new Error('Google未認証')
  const client = getOAuth2Client()
  client.setCredentials(token)
  client.on('tokens', (newTokens) => {
    saveToken({ ...token, ...newTokens }).catch((error) => console.error('Failed to persist Google OAuth token', error))
  })
  return client
}

export async function exchangeCode(code: string) {
  const client = getOAuth2Client()
  const { tokens } = await client.getToken(code)
  await saveToken(tokens)
  return tokens
}
