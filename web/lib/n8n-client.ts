import type { N8nExecution, ExecuteParams } from './types'

function config() {
  return {
    baseUrl: process.env.N8N_BASE_URL || 'http://localhost:5678',
    apiKey: process.env.N8N_API_KEY || '',
    workflowId: process.env.N8N_WORKFLOW_ID || '',
    webhookPath: process.env.N8N_WEBHOOK_PATH || 'list-collect',
  }
}

function isPlaceholder(value: string): boolean {
  return !value || /placeholder|your[_-]?|change.?me|xxxx/i.test(value)
}

function assertTrackingConfigured(): void {
  const { apiKey, workflowId } = config()
  if (isPlaceholder(apiKey)) {
    throw new Error('N8N_API_KEYが未設定のため、n8nの失敗状態を追跡できません')
  }
  if (isPlaceholder(workflowId)) {
    throw new Error('N8N_WORKFLOW_IDが未設定のため、n8nの失敗状態を追跡できません')
  }
}

export class N8nApiError extends Error {
  public readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'N8nApiError'
    this.status = status
  }
}

function headers() {
  const { apiKey } = config()
  return {
    'X-N8N-API-KEY': apiKey,
    'Content-Type': 'application/json',
  }
}

export function executionErrorMessage(execution: N8nExecution): string {
  const executionError = execution.data?.resultData?.error
  const parts = [
    executionError?.node?.name,
    executionError?.description,
    executionError?.message,
  ].filter((part): part is string => Boolean(part))
  return [...new Set(parts)].join(': ') || `n8nワークフローが${execution.status}で終了しました`
}

export async function triggerWorkflow(
  params: ExecuteParams,
  options?: { getRegisteredExecutionId?: () => Promise<string | undefined> },
): Promise<{ executionId: string }> {
  assertTrackingConfigured()
  const { baseUrl, webhookPath } = config()
  const webhookUrl = `${baseUrl}/webhook/${webhookPath}`
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new N8nApiError(`Webhook failed: ${res.status} ${text}`, res.status)
  }

  const data = await res.json().catch(() => ({}))
  const responseExecutionId = data.executionId || data.id
  if (responseExecutionId) {
    const executionId = String(responseExecutionId)
    const execution = await getExecution(executionId)
    if (execution.status === 'error' || execution.status === 'canceled') {
      throw new N8nApiError(executionErrorMessage(execution))
    }
    return { executionId }
  }

  // WebhookのonReceived応答には通常executionIdが含まれないため、runIdを
  // n8n実行データと照合してIDを補完する。これにより途中エラーも追跡できる。
  let lookupError: unknown
  for (const delayMs of [0, 250, 750, 1_500, 2_500]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    try {
      // The workflow registers $execution.id through the /started callback
      // before beginning the expensive search. This DB value is authoritative:
      // n8n does not always expose in-progress node data through its executions
      // API, so runId-based history matching alone can produce a false failure.
      const registeredExecutionId = await options?.getRegisteredExecutionId?.()
      if (registeredExecutionId) return { executionId: registeredExecutionId }

      const execution = await findExecutionByRunId(params.runId, true)
      if (!execution) continue
      if (execution.status === 'error' || execution.status === 'canceled') {
        throw new N8nApiError(executionErrorMessage(execution))
      }
      return { executionId: execution.id }
    } catch (error) {
      if (error instanceof N8nApiError && error.status === undefined) throw error
      lookupError = error
    }
  }
  const registeredExecutionId = await options?.getRegisteredExecutionId?.().catch((error) => {
    lookupError = error
    return undefined
  })
  if (registeredExecutionId) return { executionId: registeredExecutionId }
  const detail = lookupError instanceof Error ? `: ${lookupError.message}` : ''
  throw new N8nApiError(`n8n実行IDを取得できず、失敗状態を追跡できません${detail}`)
}

export async function getExecution(executionId: string): Promise<N8nExecution> {
  assertTrackingConfigured()
  const { baseUrl } = config()
  const res = await fetch(`${baseUrl}/api/v1/executions/${executionId}?includeData=true`, {
    headers: headers(),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new N8nApiError(`Failed to get execution: ${res.status}`, res.status)
  return res.json()
}

export async function listExecutions(limit = 30): Promise<{ data: N8nExecution[]; nextCursor?: string }> {
  assertTrackingConfigured()
  const { baseUrl, workflowId } = config()
  const params = new URLSearchParams({
    limit: String(limit),
    includeData: 'true',
    workflowId,
  })

  const res = await fetch(`${baseUrl}/api/v1/executions?${params}`, {
    headers: headers(),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new N8nApiError(`Failed to list executions: ${res.status}`, res.status)
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
  if (!runId) return undefined
  assertTrackingConfigured()
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
    const { baseUrl } = config()
    const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) })
    const result = res.ok
    _healthCache = { result, expiresAt: now + 30_000 }
    return result
  } catch {
    _healthCache = { result: false, expiresAt: now + 15_000 }
    return false
  }
}
