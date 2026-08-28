import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAreaSearchPartitions,
  isExplicitNotFoundCandidate,
  isNonOfficialOrganicTitle,
  runSerperSearch,
  type SerperSearchCheckpoint,
} from './serper.ts'

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

test('comparison article titles are not official HP candidates', () => {
  assert.equal(isNonOfficialOrganicTitle('東京都のTikTok運用代行会社22選とSNSに長けた企業'), true)
  assert.equal(isNonOfficialOrganicTitle('渋谷区のSNS運用代行会社15社をプロが厳選'), true)
  assert.equal(isNonOfficialOrganicTitle('株式会社サンプル｜SNS運用代行'), false)
})

test('explicit 404 results are rejected before candidate fetching', () => {
  assert.equal(isExplicitNotFoundCandidate('https://example.com/page404', '会社案内'), true)
  assert.equal(isExplicitNotFoundCandidate('https://example.com/404.html', '404 Not Found'), true)
  assert.equal(isExplicitNotFoundCandidate('https://example.com/', '404 Not Found - Example'), true)
  assert.equal(isExplicitNotFoundCandidate('https://404studio.example.com/', '株式会社404 Studio'), false)
})

test('Shibuya is split into dense neighbourhood search pools', () => {
  const partitions = getAreaSearchPartitions('渋谷区')
  assert.ok(partitions.includes('恵比寿'))
  assert.ok(partitions.includes('代官山'))
  assert.ok(partitions.includes('笹塚'))
  assert.equal(new Set(partitions).size, partitions.length)
})

test('a neighbourhood partition produces an independent Places query', async () => {
  const originalFetch = globalThis.fetch
  const queries: string[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { q: string }
    queries.push(body.q)
    return new Response(JSON.stringify({ places: [] }), { status: 200 })
  }

  try {
    await runSerperSearch({
      keywords: ['C'],
      area: '渋谷区',
      areaPartitions: ['恵比寿'],
      maxPages: 1,
      includeOrganic: false,
      requestDelayMs: 0,
      apiKey: 'test-key',
    })
    assert.ok(queries.includes('C 渋谷区'))
    assert.ok(queries.includes('C 渋谷区 恵比寿'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

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
      areaPartitions: [],
      maxPages: 4,
      includeOrganic: false,
      requestDelayMs: 0,
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
      areaPartitions: [],
      maxPages: 1,
      includeOrganic: false,
      requestDelayMs: 0,
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
      areaPartitions: [],
      maxPages: 3,
      includeOrganic: false,
      requestDelayMs: 0,
      apiKey: 'test-key',
    })
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].placeId, 'LATE')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('organic query stops after two pages add no new company hosts', async () => {
  const originalFetch = globalThis.fetch
  const originalOrganicPages = process.env.SERPER_ORGANIC_MAX_PAGES
  const originalOrganicLimit = process.env.SERPER_ORGANIC_QUERY_LIMIT
  const originalConcurrency = process.env.SERPER_CONCURRENCY
  process.env.SERPER_ORGANIC_MAX_PAGES = '4'
  process.env.SERPER_ORGANIC_QUERY_LIMIT = '1'
  process.env.SERPER_CONCURRENCY = '1'
  const organicPages: number[] = []
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { page: number }
    if (String(input).includes('/places')) {
      return new Response(JSON.stringify({ places: [] }), { status: 200 })
    }
    organicPages.push(body.page)
    const host = body.page < 4 ? 'same-company.example.com' : 'new-company.example.com'
    return new Response(JSON.stringify({
      organic: [{
        link: `https://${host}/page-${body.page}`,
        title: '株式会社サンプル｜公式サイト',
        snippet: '対象サービスを提供しています',
      }],
    }), { status: 200 })
  }

  try {
    const result = await runSerperSearch({
      keywords: ['SNS運用会社'],
      area: '渋谷区',
      areaPartitions: [],
      maxPages: 1,
      requestDelayMs: 0,
      apiKey: 'test-key',
    })
    assert.deepEqual(organicPages, [1, 2, 3])
    assert.equal(result.stats.organicExhaustedQueryCount, 1)
    assert.equal(result.items.filter((item) => item.source === 'organic').length, 1)
    assert.equal(result.items.some((item) => item.link.includes('new-company')), false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalOrganicPages === undefined) delete process.env.SERPER_ORGANIC_MAX_PAGES
    else process.env.SERPER_ORGANIC_MAX_PAGES = originalOrganicPages
    if (originalOrganicLimit === undefined) delete process.env.SERPER_ORGANIC_QUERY_LIMIT
    else process.env.SERPER_ORGANIC_QUERY_LIMIT = originalOrganicLimit
    if (originalConcurrency === undefined) delete process.env.SERPER_CONCURRENCY
    else process.env.SERPER_CONCURRENCY = originalConcurrency
  }
})

test('organic checkpoints are safe to persist in PostgreSQL jsonb', async () => {
  const originalFetch = globalThis.fetch
  const originalOrganicPages = process.env.SERPER_ORGANIC_MAX_PAGES
  const originalOrganicLimit = process.env.SERPER_ORGANIC_QUERY_LIMIT
  const originalConcurrency = process.env.SERPER_CONCURRENCY
  process.env.SERPER_ORGANIC_MAX_PAGES = '1'
  process.env.SERPER_ORGANIC_QUERY_LIMIT = '1'
  process.env.SERPER_CONCURRENCY = '1'
  let organicCheckpoint: SerperSearchCheckpoint | undefined

  globalThis.fetch = async (input) => {
    if (String(input).includes('/places')) {
      return new Response(JSON.stringify({ places: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({
      organic: [{
        link: 'https://safe-checkpoint.example.com/',
        title: '株式会社サンプル｜公式サイト',
        snippet: 'SNS運用サービスを提供しています',
      }],
    }), { status: 200 })
  }

  try {
    await runSerperSearch({
      keywords: ['SNS運用会社'],
      area: '渋谷区',
      areaPartitions: [],
      maxPages: 1,
      requestDelayMs: 0,
      apiKey: 'test-key',
      onProgress: (_progress, checkpoint) => {
        if (checkpoint?.phase === 'complete') organicCheckpoint = checkpoint
      },
    })

    assert.ok(organicCheckpoint)
    const serialized = JSON.stringify(organicCheckpoint)
    assert.equal(serialized.includes('\\u0000'), false)
    assert.deepEqual(
      organicCheckpoint.organicSeenByKeyword.map(([key]) => key),
      ['["SNS運用会社","公式"]'],
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalOrganicPages === undefined) delete process.env.SERPER_ORGANIC_MAX_PAGES
    else process.env.SERPER_ORGANIC_MAX_PAGES = originalOrganicPages
    if (originalOrganicLimit === undefined) delete process.env.SERPER_ORGANIC_QUERY_LIMIT
    else process.env.SERPER_ORGANIC_QUERY_LIMIT = originalOrganicLimit
    if (originalConcurrency === undefined) delete process.env.SERPER_CONCURRENCY
    else process.env.SERPER_CONCURRENCY = originalConcurrency
  }
})

test('completed page checkpoint resumes from the next page after time budget', async () => {
  const originalFetch = globalThis.fetch
  const originalConcurrency = process.env.SERPER_CONCURRENCY
  process.env.SERPER_CONCURRENCY = '1'
  const firstPages: number[] = []
  let savedCheckpoint: SerperSearchCheckpoint | undefined
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { page: number }
    firstPages.push(body.page)
    if (body.page === 1) await new Promise((resolve) => setTimeout(resolve, 15))
    return new Response(JSON.stringify({ places: [place(`P${body.page}`)] }), { status: 200 })
  }

  try {
    const first = await runSerperSearch({
      keywords: ['C'],
      area: '渋谷区',
      areaPartitions: [],
      maxPages: 2,
      includeOrganic: false,
      requestDelayMs: 0,
      timeBudgetMs: 10,
      apiKey: 'test-key',
      onProgress: (_progress, checkpoint) => {
        if (checkpoint) savedCheckpoint = checkpoint
      },
    })
    assert.equal(first.stats.searchTimeBudgetReached, true)
    assert.deepEqual(firstPages, [1])
    assert.equal(savedCheckpoint?.phase, 'places')
    assert.equal(savedCheckpoint?.nextPage, 2)

    const resumedPages: number[] = []
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { page: number }
      resumedPages.push(body.page)
      return new Response(JSON.stringify({ places: [place(`P${body.page}`)] }), { status: 200 })
    }
    const resumed = await runSerperSearch({
      keywords: ['C'],
      area: '渋谷区',
      areaPartitions: [],
      maxPages: 2,
      includeOrganic: false,
      requestDelayMs: 0,
      timeBudgetMs: 1_000,
      checkpoint: savedCheckpoint,
      apiKey: 'test-key',
    })
    assert.deepEqual(resumedPages, [2])
    assert.deepEqual(resumed.items.map((item) => item.placeId), ['P1', 'P2'])
    assert.equal(resumed.stats.searchTimeBudgetReached, false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalConcurrency === undefined) delete process.env.SERPER_CONCURRENCY
    else process.env.SERPER_CONCURRENCY = originalConcurrency
  }
})
