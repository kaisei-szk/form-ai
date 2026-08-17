import axios from 'axios'
import logger from '../utils/logger.js'
import { sleep } from '../utils/http-client.js'

const SERPER_API_KEY = process.env.SERPER_API_KEY
const REQUEST_DELAY = parseInt(process.env.REQUEST_DELAY_MS || '1100')
const MAX_PAGES = 10

const BLOCKED_DOMAINS = [
  'jalan.net', 'tabelog.com', 'hotpepper.jp', 'ekiten.jp', 'navitime.co.jp',
  'mapion.co.jp', 'yelp.com', 'retty.me', 'gurunavi.com', 'google.com',
  'google.co.jp', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'youtube.com', 'linkedin.com', 'tiktok.com', 'indeed.com', 'wantedly.com',
  'yahoo.co.jp', 'rakuten.co.jp', 'amazon.co.jp', 'minimo.io', 'epark.jp',
  'baseconnect.in',
]

const PREFECTURES = [
  '北海道', '東京都', '京都府', '大阪府', '青森県', '岩手県', '宮城県',
  '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県',
  '千葉県', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県',
  '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
]

/**
 * Serper local search only. Every keyword is queried independently and no
 * contact-page suffix or AND/OR expression is added.
 */
export async function searchBySerper(params) {
  const { industry, area, keywords = [industry], maxResults = 0 } = params
  if (!SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY が設定されていません。https://serper.dev でAPIキーを取得してください')
  }

  const normalizedArea = normalizeArea(area)
  const searchTerms = [...new Set(keywords.map(k => String(k).normalize('NFKC').trim()).filter(Boolean))]
  const limit = Number(maxResults) > 0 ? Number(maxResults) : Number.POSITIVE_INFINITY
  const results = []
  const seenPlaces = new Set()
  const seenUrls = new Set()
  const exhausted = new Set()
  const zeroNewPages = new Map()

  for (let page = 1; page <= MAX_PAGES && results.length < limit; page++) {
    for (const keyword of searchTerms) {
      if (exhausted.has(keyword) || results.length >= limit) continue
      const query = `${keyword} ${normalizedArea}`.trim()
      logger.info(`Serperローカル検索: "${query}" page=${page}`)

      let places
      try {
        places = await fetchPlaces(query, page)
      } catch (error) {
        logger.error(`Serper検索エラー: "${query}" page=${page}`, { error: error.message })
        continue
      }

      let newPlacesOnPage = 0
      for (const place of places) {
        const placeKey = place.placeId || place.cid || `${place.title || ''}|${place.address || ''}`
        if (!placeKey || seenPlaces.has(placeKey)) continue
        seenPlaces.add(placeKey)
        newPlacesOnPage++

        const url = place.website?.trim() || ''
        if (!url || !matchesArea(place.address || '', normalizedArea)) continue
        if (isBlockedUrl(url) || !matchesIndustry(place, [industry, ...searchTerms])) continue

        const normalizedUrl = normalizeUrl(url)
        if (!normalizedUrl || seenUrls.has(normalizedUrl)) continue
        seenUrls.add(normalizedUrl)
        results.push({
          name: place.title || '',
          url,
          snippet: place.description || '',
          phone: place.phoneNumber || '',
          address: place.address || '',
          industry,
          area,
          keyword,
          source: 'serper',
        })
        if (results.length >= limit) break
      }

      const emptyPages = newPlacesOnPage === 0 ? (zeroNewPages.get(keyword) || 0) + 1 : 0
      zeroNewPages.set(keyword, emptyPages)
      if (places.length === 0 || emptyPages >= 2) exhausted.add(keyword)
      await sleep(REQUEST_DELAY)
    }
  }

  logger.info(`Serper検索完了: ${results.length}件`, { industry, area: normalizedArea })
  return results
}

async function fetchPlaces(query, page) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.post(
        'https://google.serper.dev/places',
        { q: query, gl: 'jp', hl: 'ja', page },
        {
          headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
          timeout: 30000,
        },
      )
      return response.data.places || []
    } catch (error) {
      lastError = error
      const status = error.response?.status
      if (status && status !== 429 && status < 500) break
      if (attempt < 2) await sleep(1000 * (2 ** attempt))
    }
  }
  throw lastError || new Error('Unknown Serper error')
}

function normalizeArea(rawArea) {
  const area = String(rawArea || '').normalize('NFKC').trim()
  return PREFECTURES.find(prefecture => prefecture.replace(/[都道府県]$/, '') === area) || area
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\u3000・･,，.。/／\\|｜「」『』【】()（）［］\[\]{}]/g, '')
}

function matchesArea(address, area) {
  const needle = normalizeText(area).replace(/(?:駅周辺|駅付近|周辺|付近)$/, '')
  return Boolean(needle && normalizeText(address).includes(needle))
}

function matchesIndustry(place, terms) {
  const evidence = normalizeText([
    place.title,
    place.type,
    place.category,
    place.description,
  ].filter(Boolean).join(' '))
  return [...new Set(terms.map(normalizeText))]
    .some(term => term.length >= 2 && evidence.includes(term))
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']) {
      parsed.searchParams.delete(key)
    }
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    return parsed.toString()
  } catch {
    return ''
  }
}

function isBlockedUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return BLOCKED_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return true
  }
}
