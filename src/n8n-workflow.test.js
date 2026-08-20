import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('execution registration sends an object body before Serper search', async () => {
  const workflow = JSON.parse(
    await readFile(new URL('../n8n/workflow.json', import.meta.url), 'utf8'),
  )
  const registerNode = workflow.nodes.find((node) => node.name === 'n8n実行ID登録')

  assert.ok(registerNode, 'n8n実行ID登録 node is required')
  assert.equal(registerNode.parameters.specifyBody, 'json')
  assert.match(registerNode.parameters.jsonBody, /n8nExecutionId:\s*\$execution\.id/)
  assert.doesNotMatch(registerNode.parameters.jsonBody, /JSON\.stringify/)
  assert.equal(
    workflow.connections['n8n実行ID登録'].main[0][0].node,
    'L-02: Serper検索（公式HP候補取得）',
  )
})

test('Serper API errors are not converted into an empty successful result', async () => {
  const workflow = JSON.parse(
    await readFile(new URL('../n8n/workflow.json', import.meta.url), 'utf8'),
  )
  const splitNode = workflow.nodes.find((node) => node.name === '検索結果を分割')
  assert.ok(splitNode, '検索結果を分割 node is required')
  assert.match(splitNode.parameters.jsCode, /searchResponse\.success === false \|\| searchResponse\.error/)
  assert.match(splitNode.parameters.jsCode, /throw new Error/)
})

test('normal CSV export remains isolated from discovery candidates', async () => {
  const normalExport = await readFile(
    new URL('../web/app/api/sheets/export/route.ts', import.meta.url),
    'utf8',
  )
  const candidateExport = await readFile(
    new URL('../web/app/api/search-candidates/export/route.ts', import.meta.url),
    'utf8',
  )
  assert.match(normalExport, /getCompanies/)
  assert.doesNotMatch(normalExport, /search-candidates-db|search_candidates/)
  assert.match(candidateExport, /getAllSearchCandidates/)
  assert.match(candidateExport, /候補サイト名/)
})
