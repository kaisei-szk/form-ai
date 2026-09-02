import { getAllCompaniesForRun, updateCompanyName } from './companies-db'
import {
  chooseBestOfficialBusinessName,
  extractCompanyPageLinks,
  isSuspiciousBusinessName,
} from './business-name'

export interface BusinessNameRepairResult {
  checked: number
  suspicious: number
  updated: number
  unresolved: number
}

const FETCH_TIMEOUT_MS = 8_000
const MAX_HTML_CHARS = 750_000
const CONCURRENCY = 5

function decodeHtml(buffer: ArrayBuffer, contentType: string): string {
  const preview = Buffer.from(buffer.slice(0, 4_000)).toString('latin1')
  const charset = (
    contentType.match(/charset=["']?([\w-]+)/i)?.[1]
    ?? preview.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
    ?? preview.match(/charset=([\w-]+)/i)?.[1]
    ?? 'utf-8'
  ).toLowerCase()
  const encoding = /shift.?jis|sjis|cp932|windows-31j|ms_kanji/i.test(charset)
    ? 'windows-31j'
    : /euc.?jp/i.test(charset)
      ? 'euc-jp'
      : /iso.?2022.?jp/i.test(charset)
        ? 'iso-2022-jp'
        : 'utf-8'
  try {
    return new TextDecoder(encoding).decode(buffer).slice(0, MAX_HTML_CHARS)
  } catch {
    return Buffer.from(buffer).toString('utf8').slice(0, MAX_HTML_CHARS)
  }
}

async function fetchHtml(rawUrl: string): Promise<{ url: string; html: string } | null> {
  let url: URL
  try { url = new URL(rawUrl) } catch { return null }
  if (!/^https?:$/.test(url.protocol)) return null

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FormAI-CompanyNameVerifier/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.5',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) return null
    const contentLength = Number(response.headers.get('content-length') ?? '0')
    if (contentLength > 3_000_000) return null
    const html = decodeHtml(await response.arrayBuffer(), contentType)
    return html ? { url: response.url || url.toString(), html } : null
  } catch {
    return null
  }
}

async function resolveOfficialName(hpUrl: string): Promise<string | null> {
  let input: URL
  try { input = new URL(hpUrl) } catch { return null }
  if (!/^https?:$/.test(input.protocol)) return null

  const initialUrls = [...new Set([input.toString(), `${input.origin}/`])]
  const initialPages = (await Promise.all(initialUrls.map(fetchHtml)))
    .filter((page): page is { url: string; html: string } => page !== null)
  if (initialPages.length === 0) return null

  const companyLinks = initialPages
    .flatMap((page) => extractCompanyPageLinks(page.html, page.url))
    .filter((url, index, urls) => urls.indexOf(url) === index)
    .slice(0, 2)
  const companyPages = (await Promise.all(companyLinks.map(fetchHtml)))
    .filter((page): page is { url: string; html: string } => page !== null)

  const best = chooseBestOfficialBusinessName([...companyPages, ...initialPages])
  return best?.name ?? null
}

/**
 * Runs only after all search/scrape batches have persisted their rows. It does
 * not add, remove or reclassify results; only clearly broken display names are
 * replaced when the official site provides a stronger name.
 */
export async function repairSuspiciousBusinessNames(runId: string): Promise<BusinessNameRepairResult> {
  const companies = await getAllCompaniesForRun(runId)
  const suspicious = companies.filter((company) => isSuspiciousBusinessName(company.name))
  let nextIndex = 0
  let updated = 0

  const worker = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= suspicious.length) return
      const company = suspicious[index]
      const officialName = await resolveOfficialName(company.hpUrl)
      if (!officialName || isSuspiciousBusinessName(officialName)) continue
      try {
        if (await updateCompanyName(company.id, officialName)) updated++
      } catch {
        // One transient DB update must not prevent the remaining names from
        // being checked or fail the already-complete search run.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, suspicious.length) }, worker))
  return {
    checked: companies.length,
    suspicious: suspicious.length,
    updated,
    unresolved: suspicious.length - updated,
  }
}
