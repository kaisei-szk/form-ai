import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// ルートの .env を読み込んで process.env に反映する。
// web/.env.local に無いキーだけを補完するので、web固有の .env.local が優先される。
const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env')
try {
  for (const line of readFileSync(rootEnvPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
} catch {
  // ルート .env が無ければ何もしない
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  output: 'standalone',
}

export default nextConfig
