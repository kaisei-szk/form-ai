import assert from 'node:assert/strict'
import test from 'node:test'
import { executionErrorMessage, triggerWorkflow } from './n8n-client.ts'
import type { N8nExecution } from './types.ts'

const failedExecution: N8nExecution = {
  id: '42',
  finished: true,
  mode: 'webhook',
  status: 'error',
  startedAt: '2026-08-20T00:00:00.000Z',
  stoppedAt: '2026-08-20T00:00:01.000Z',
  workflowId: 'workflow-test',
  data: {
    resultData: {
      runData: {
        Webhook: [{ data: { main: [[{ json: { body: { runId: 'run-test' } } }]] } }],
      },
      error: {
        node: { name: '検索ノード' },
        message: 'API request failed',
      },
    },
  },
}

test('execution error includes the failing n8n node', () => {
  assert.equal(executionErrorMessage(failedExecution), '検索ノード: API request failed')
})

test('a workflow that fails immediately is rejected instead of reported as running', async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = {
    baseUrl: process.env.N8N_BASE_URL,
    apiKey: process.env.N8N_API_KEY,
    workflowId: process.env.N8N_WORKFLOW_ID,
  }
  process.env.N8N_BASE_URL = 'http://n8n.test'
  process.env.N8N_API_KEY = 'valid-test-key'
  process.env.N8N_WORKFLOW_ID = 'workflow-test'

  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/webhook/')) {
      return new Response(JSON.stringify({ message: 'Workflow was started' }), { status: 200 })
    }
    if (url.includes('/api/v1/executions?')) {
      return new Response(JSON.stringify({ data: [failedExecution] }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  try {
    await assert.rejects(
      triggerWorkflow({
        industry: '美容室',
        area: '渋谷区',
        projectId: 'project-test',
        runId: 'run-test',
      }),
      /検索ノード: API request failed/,
    )
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnv)) {
      const envKey = key === 'baseUrl' ? 'N8N_BASE_URL' : key === 'apiKey' ? 'N8N_API_KEY' : 'N8N_WORKFLOW_ID'
      if (value === undefined) delete process.env[envKey]
      else process.env[envKey] = value
    }
  }
})

test('the execution id registered by the started callback is authoritative', async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = {
    baseUrl: process.env.N8N_BASE_URL,
    apiKey: process.env.N8N_API_KEY,
    workflowId: process.env.N8N_WORKFLOW_ID,
  }
  process.env.N8N_BASE_URL = 'http://n8n.test'
  process.env.N8N_API_KEY = 'valid-test-key'
  process.env.N8N_WORKFLOW_ID = 'workflow-test'
  let executionListRequested = false

  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/webhook/')) {
      return new Response(JSON.stringify({ message: 'Workflow was started' }), { status: 200 })
    }
    if (url.includes('/api/v1/executions?')) executionListRequested = true
    throw new Error(`Unexpected URL: ${url}`)
  }

  try {
    const result = await triggerWorkflow({
      industry: '美容室',
      area: '渋谷区',
      projectId: 'project-test',
      runId: 'run-test',
    }, {
      getRegisteredExecutionId: async () => '43',
    })
    assert.equal(result.executionId, '43')
    assert.equal(executionListRequested, false)
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnv)) {
      const envKey = key === 'baseUrl' ? 'N8N_BASE_URL' : key === 'apiKey' ? 'N8N_API_KEY' : 'N8N_WORKFLOW_ID'
      if (value === undefined) delete process.env[envKey]
      else process.env[envKey] = value
    }
  }
})
