import assert from 'node:assert/strict'
import test from 'node:test'
import { runSerperSearch } from './serper.ts'

type MockPlace = {
  placeId: string
  title: string
  address: string
  website: string
  type: string
}

function place(id: string): MockPlace {
  return {
    placeId: id,
    title: `候補${id}`,
    address: `東京都渋谷区${id}1-1`,
    website: `https://${id.toLowerCase()}.example.com/`,
    type: '対象業種',
  }
}

test('another keyword does not cause premature saturation through global deduplication', async () => {
  const pages: Record<string, MockPlace[]> = {
    'A:1': [place('X')],
    'A:2': [place('X')],
    'A:3': [place('X')],
    'B:1': [place('X')],
    'B:2': [place('X')],
    'B:3': [place('Z')],
    'B:4': [],
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { q: string; page: number }
    const keyword = body.q.split(' ')[0]
    return new Response(JSON.stringify({ places: pages[`${keyword}:${body.page}`] ?? [] }), { status: 200 })
  }

  try {
    const result = await runSerperSearch({
      keywords: ['A', 'B'],
      area: '渋谷区',
      maxPages: 4,
      includeOrganic: false,
      apiKey: 'test-key',
    })
    assert.deepEqual(result.items.map((item) => item.placeId), ['X', 'Z'])
    assert.ok(result.stats.paginationRepeatCount >= 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('industry synonym keywords widen places discovery', async () => {
  const originalFetch = globalThis.fetch
  const queries: string[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { q: string }
    queries.push(body.q)
    const places = body.q.startsWith('美容院 ') ? [place('SYN')] : []
    return new Response(JSON.stringify({ places }), { status: 200 })
  }

  try {
    const result = await runSerperSearch({
      keywords: ['美容室'],
      area: '渋谷区',
      maxPages: 1,
      includeOrganic: false,
      apiKey: 'test-key',
    })
    assert.ok(queries.some((q) => q.startsWith('美容室 ')))
    assert.ok(queries.some((q) => q.startsWith('美容院 ')))
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].keyword, '美容院')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('one empty page is retried before a query is considered exhausted', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { page: number }
    const places = body.page === 2 ? [place('LATE')] : []
    return new Response(JSON.stringify({ places }), { status: 200 })
  }

  try {
    const result = await runSerperSearch({
      keywords: ['C'],
      area: '渋谷区',
      maxPages: 3,
      includeOrganic: false,
      apiKey: 'test-key',
    })
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].placeId, 'LATE')
  } finally {
    globalThis.fetch = originalFetch
  }
})
