import type { N8nExecution, ExecuteParams } from './types'

const BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5678'
const API_KEY = process.env.N8N_API_KEY || ''
const WORKFLOW_ID = process.env.N8N_WORKFLOW_ID || ''
const WEBHOOK_PATH = process.env.N8N_WEBHOOK_PATH || 'list-collect'

function headers() {
  return {
    'X-N8N-API-KEY': API_KEY,
    'Content-Type': 'application/json',
  }
}

export async function triggerWorkflow(params: ExecuteParams): Promise<{ executionId?: string }> {
  const webhookUrl = `${BASE_URL}/webhook/${WEBHOOK_PATH}`
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Webhook failed: ${res.status} ${text}`)
  }

  const data = await res.json().catch(() => ({}))
  const responseExecutionId = data.executionId || data.id
  if (responseExecutionId) return { executionId: String(responseExecutionId) }

  // WebhookのonReceived応答には通常executionIdが含まれないため、runIdを
  // n8n実行データと照合してIDを補完する。これにより途中エラーも追跡できる。
  for (const delayMs of [0, 250, 750, 1_500]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const execution = await findExecutionByRunId(params.runId, true).catch(() => undefined)
    if (execution) return { executionId: execution.id }
  }
  return {}
}

export async function getExecution(executionId: string): Promise<N8nExecution> {
  const res = await fetch(`${BASE_URL}/api/v1/executions/${executionId}?includeData=true`, {
    headers: headers(),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`Failed to get execution: ${res.status}`)
  return res.json()
}

export async function listExecutions(limit = 30): Promise<{ data: N8nExecution[]; nextCursor?: string }> {
  const params = new URLSearchParams({
    limit: String(limit),
    includeData: 'true',
    ...(WORKFLOW_ID ? { workflowId: WORKFLOW_ID } : {}),
  })

  const res = await fetch(`${BASE_URL}/api/v1/executions?${params}`, {
    headers: headers(),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`Failed to list executions: ${res.status}`)
  return res.json()
}

let recentExecutionsCache: { expiresAt: number; data: N8nExecution[] } | null = null
let recentExecutionsRequest: Promise<N8nExecution[]> | null = null

async function recentExecutions(): Promise<N8nExecution[]> {
  const now = Date.now()
  if (recentExecutionsCache && recentExecutionsCache.expiresAt > now) {
    return recentExecutionsCache.data
  }
  if (recentExecutionsRequest) return recentExecutionsRequest

  recentExecutionsRequest = listExecutions(50)
    .then(({ data }) => {
      recentExecutionsCache = { expiresAt: Date.now() + 2_000, data }
      return data
    })
    .finally(() => {
      recentExecutionsRequest = null
    })
  return recentExecutionsRequest
}

function executionRunId(execution: N8nExecution): string | undefined {
  const runData = execution.data?.resultData?.runData
  if (!runData) return undefined

  for (const nodeRuns of Object.values(runData)) {
    for (const nodeRun of nodeRuns) {
      const main = (nodeRun as {
        data?: { main?: Array<Array<{ json?: Record<string, unknown> }> | null> }
      }).data?.main
      for (const output of main ?? []) {
        for (const item of output ?? []) {
          const json = item.json
          if (!json) continue
          if (typeof json.runId === 'string' && json.runId) return json.runId
          const body = json.body
          if (body && typeof body === 'object' && typeof (body as { runId?: unknown }).runId === 'string') {
            return (body as { runId: string }).runId
          }
        }
      }
    }
  }
  return undefined
}

export async function findExecutionByRunId(runId: string, forceRefresh = false): Promise<N8nExecution | undefined> {
  if (!runId || !API_KEY) return undefined
  const data = forceRefresh
    ? (await listExecutions(50)).data
    : await recentExecutions()
  return data.find((execution) => executionRunId(execution) === runId)
}

// In-memory cache for health status (30-second TTL in Node.js process)
let _healthCache: { result: boolean; expiresAt: number } | null = null

export async function checkN8nHealth(): Promise<boolean> {
  const now = Date.now()
  if (_healthCache && now < _healthCache.expiresAt) return _healthCache.result
  try {
    const res = await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(5000) })
    const result = res.ok
    _healthCache = { result, expiresAt: now + 30_000 }
    return result
  } catch {
    _healthCache = { result: false, expiresAt: now + 15_000 }
    return false
  }
}
