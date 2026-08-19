import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCandidateRelevance, isDirectorySchemaTypes, validateAreaInput } from './search-relevance.ts'

const organicBase = {
  industry: 'M&A仲介会社',
  keywords: ['M&A仲介会社', 'M&A仲介業者'],
  area: '千代田区',
  searchArea: '千代田区',
  source: 'organic' as const,
  sourceTitle: 'ABC M&A仲介株式会社',
  sourceSnippet: '',
  sourceAddress: '',
  sourceCategory: '',
  extractedAddress: '東京都千代田区丸の内1-1-1',
  homepageTitle: 'ABC M&A仲介株式会社',
  homepageText: '中小企業のM&A仲介と事業承継を支援します。',
}

test('organic result needs exact on-site area and industry evidence', () => {
  const accepted = evaluateCandidateRelevance({ ...organicBase, url: 'https://abc-ma.example/' })
  assert.equal(accepted.status, 'accepted')

  const wrongArea = evaluateCandidateRelevance({
    ...organicBase,
    url: 'https://abc-ma.example/',
    extractedAddress: '東京都港区赤坂1-1-1',
  })
  assert.equal(wrongArea.status, 'rejected')
  assert.ok(wrongArea.reasons.includes('area_mismatch'))
})

test('known directory cannot be admitted as an official organic site', () => {
  const result = evaluateCandidateRelevance({
    ...organicBase,
    url: 'https://imitsu.jp/example-company',
  })
  assert.equal(result.status, 'rejected')
  assert.ok(result.reasons.includes('unverified_official_site'))
})

test('comparison and listing media never become final official HPs', () => {
  for (const url of [
    'https://web-kanji.com/posts/sns-tokyo',
    'https://it-trend.jp/sns_operation_service/21926',
    'https://solution-store.honichi.com/solutions/example/',
    'https://hokihosting.com/it/115096/',
  ]) {
    const result = evaluateCandidateRelevance({
      ...organicBase,
      url,
      industry: 'SNS運用代行会社',
      keywords: ['SNS運用代行会社'],
      area: '渋谷区',
      searchArea: '渋谷区',
      homepageTitle: 'SNS運用代行会社',
      homepageText: '所在地 東京都渋谷区道玄坂1-1-1 SNS運用代行サービスを提供します。',
      extractedAddress: '東京都渋谷区道玄坂1-1-1',
    })
    assert.equal(result.status, 'rejected', url)
    assert.ok(result.reasons.includes('unverified_official_site'), url)
  }
})

test('a posts article URL is not emitted as an official HP even on an unknown host', () => {
  const result = evaluateCandidateRelevance({
    ...organicBase,
    url: 'https://unknown-media.example.jp/posts/12345',
    industry: 'SNS運用代行会社',
    keywords: ['SNS運用代行会社'],
    area: '渋谷区',
    searchArea: '渋谷区',
    homepageTitle: 'SNS運用代行会社の紹介',
    homepageText: '所在地 東京都渋谷区道玄坂1-1-1 SNS運用代行サービスを紹介します。',
    extractedAddress: '東京都渋谷区道玄坂1-1-1',
  })
  assert.equal(result.status, 'rejected')
  assert.ok(result.reasons.includes('unverified_official_site'))
})

test('an organic comparison article title is rejected even on a corporate domain', () => {
  const result = evaluateCandidateRelevance({
    ...organicBase,
    url: 'https://agency.example.jp/marketing/tokyo-sns/',
    sourceTitle: '東京都のSNS運用代行会社22選とSNSに長けた企業',
    homepageTitle: '東京都のSNS運用代行会社22選とSNSに長けた企業',
    industry: 'SNS運用代行会社',
    keywords: ['SNS運用代行会社'],
    area: '渋谷区',
    searchArea: '渋谷区',
    homepageText: '所在地 東京都渋谷区道玄坂1-1-1 SNS運用代行サービスを紹介します。',
    extractedAddress: '東京都渋谷区道玄坂1-1-1',
  })
  assert.equal(result.status, 'rejected')
  assert.ok(result.reasons.includes('unverified_official_site'))
})

test('business schema allows body evidence but directory schema does not', () => {
  const base = {
    url: 'https://example.jp/',
    industry: 'M&A仲介会社',
    keywords: ['M&A仲介会社'],
    area: '千代田区',
    source: 'organic' as const,
    homepageTitle: '株式会社サンプル',
    homepageText: '当社はM&A仲介を行っています。',
    extractedAddress: '東京都千代田区丸の内1-1-1',
    hasBusinessSchema: true,
  }

  assert.equal(evaluateCandidateRelevance(base).status, 'accepted')
  assert.equal(evaluateCandidateRelevance({ ...base, hasDirectorySchema: true }).status, 'rejected')
  assert.equal(evaluateCandidateRelevance({
    ...base,
    url: 'https://example.jp/news/company-story',
    homepageTitle: 'M&A仲介会社としての取り組み',
  }).status, 'rejected')
})

test('CollectionPage alone is not directory proof', () => {
  assert.equal(isDirectorySchemaTypes(['Organization', 'CollectionPage']), false)
  assert.equal(isDirectorySchemaTypes(['CollectionPage', 'ItemList']), true)
  assert.equal(isDirectorySchemaTypes(['SearchResultsPage']), true)
})

test('service headings are valid first-party industry evidence', () => {
  const result = evaluateCandidateRelevance({
    url: 'https://example.jp/',
    industry: 'M&A仲介会社',
    keywords: ['M&A仲介会社'],
    area: '千代田区',
    source: 'places',
    sourceTitle: '株式会社サンプル',
    sourceCategory: '企業経営コンサルタント',
    sourceAddress: '東京都千代田区丸の内1-1-1',
    homepageTitle: '株式会社サンプル',
    homepageText: '主なサービス内容 M&A仲介サービス 売り手のお客様に最適な買い手候補をご紹介します。',
  })
  assert.equal(result.status, 'accepted')
})

test('company-page business descriptions can recover a valid candidate', () => {
  const result = evaluateCandidateRelevance({
    url: 'https://example.jp/',
    industry: '人材紹介会社',
    keywords: ['人材紹介会社'],
    area: '渋谷区',
    source: 'organic',
    extractedAddress: '東京都渋谷区神南1-1-1',
    homepageTitle: '株式会社サンプル 会社概要',
    homepageText: '会社概要 事業内容 人材紹介事業 厚生労働大臣許可番号13-ユ-000000',
    hasBusinessSchema: true,
  })
  assert.equal(result.status, 'accepted')
})

test('explicit first-party denial overrides nearby industry terms', () => {
  const result = evaluateCandidateRelevance({
    url: 'https://example.jp/',
    industry: 'M&A仲介会社',
    keywords: ['M&A仲介会社'],
    area: '千代田区',
    source: 'places',
    sourceAddress: '東京都千代田区丸の内1-1-1',
    homepageTitle: '株式会社サンプル',
    homepageText: '弊社は中小企業のためにあるべきサービスを追求するという想いから、M&Aの仲介業務はせず、ファイナンシャルアドバイザリー業務だけに特化しています。',
  })
  assert.equal(result.status, 'rejected')
  assert.ok(result.reasons.includes('negative_industry_evidence'))
})

test('a standard corporate page can use exact body industry evidence', () => {
  const base = {
    industry: 'M&A仲介会社',
    keywords: ['M&A仲介会社'],
    area: '千代田区',
    source: 'organic' as const,
    homepageTitle: '株式会社サンプル｜企業情報',
    homepageText: '当社はM&A仲介を行っています。',
    extractedAddress: '東京都千代田区丸の内1-1-1',
  }

  assert.equal(evaluateCandidateRelevance({ ...base, url: 'https://example.jp/company/' }).status, 'accepted')
  assert.equal(evaluateCandidateRelevance({ ...base, url: 'https://example.jp/news/article-1' }).status, 'rejected')
})

test('Places does not treat a search snippet as industry proof', () => {
  const base = {
    url: 'https://example.jp/service/article',
    industry: 'M&A仲介会社',
    keywords: ['M&A仲介会社'],
    area: '千代田区',
    source: 'places' as const,
    sourceTitle: '株式会社サンプル',
    sourceCategory: '不動産会社',
    sourceSnippet: 'M&A仲介会社について解説します',
    sourceAddress: '東京都千代田区丸の内1-1-1',
    homepageTitle: '株式会社サンプル',
    homepageText: '不動産売買を行っています。',
  }
  assert.equal(evaluateCandidateRelevance(base).status, 'rejected')
  assert.equal(evaluateCandidateRelevance({
    ...base,
    url: 'https://example.jp/',
    homepageText: '当社はM&A仲介会社です。',
  }).status, 'accepted')
})

test('related-company text is not the candidate own industry declaration', () => {
  const result = evaluateCandidateRelevance({
    url: 'https://example.jp/about/',
    industry: 'M&A仲介会社',
    keywords: ['M&A仲介会社'],
    area: '千代田区',
    source: 'organic',
    homepageTitle: '株式会社サンプル｜会社概要',
    homepageText: '関連会社: 株式会社ABC（M&A仲介会社）',
    extractedAddress: '東京都千代田区丸の内1-1-1',
    hasBusinessSchema: true,
  })
  // 矛盾ではなく情報不足なので、除外ではなく保留になる
  assert.equal(result.status, 'hold')
  assert.ok(result.reasons.includes('missing_industry_evidence'))
})

test('industry synonyms bridge the keyword and the listing category', () => {
  const result = evaluateCandidateRelevance({
    url: 'https://salon-x.example.jp/',
    industry: '美容室',
    keywords: ['美容室'],
    area: '渋谷区',
    source: 'places',
    sourceTitle: 'HAIR SALON X 渋谷',
    sourceCategory: '美容院',
    sourceAddress: '東京都渋谷区神南1-1-1',
    homepageTitle: null,
    homepageText: null,
  })
  assert.equal(result.status, 'accepted')
  assert.ok(result.evidence.includes('listing_category_match'))
})

test('a verified listing without industry text is held, not rejected', () => {
  const result = evaluateCandidateRelevance({
    url: 'https://salon-y.example.jp/',
    industry: '美容室',
    keywords: ['美容室'],
    area: '渋谷区',
    source: 'places',
    sourceTitle: 'サロンY',
    sourceCategory: '',
    sourceAddress: '東京都渋谷区宇田川町1-1',
  })
  assert.equal(result.status, 'hold')
  assert.ok(result.reasons.includes('missing_industry_evidence'))
})

test('listing phone matching the site phone accepts the candidate', () => {
  const result = evaluateCandidateRelevance({
    url: 'https://salon-z.example.jp/',
    industry: '美容室',
    keywords: ['美容室'],
    area: '渋谷区',
    source: 'places',
    sourceTitle: 'サロンZ',
    sourceAddress: '東京都渋谷区宇田川町2-2',
    sourcePhone: '03-1234-5678',
    extractedPhone: '0312345678',
    homepageTitle: 'サロンZ',
  })
  assert.equal(result.status, 'accepted')
  assert.ok(result.evidence.includes('phone_match'))
})

test('service-area claims alone are not treated as a location', () => {
  const result = evaluateCandidateRelevance({
    url: 'https://example.jp/',
    industry: '人材紹介会社',
    keywords: ['人材紹介会社'],
    area: '渋谷区',
    source: 'organic',
    homepageTitle: '株式会社サンプル',
    homepageText: '渋谷区対応の人材紹介サービスです。当社は人材紹介事業を行っています。',
  })
  assert.notEqual(result.status, 'accepted')
  assert.ok(result.reasons.includes('missing_area_evidence'))
})

test('test and staging subdomains are never official output', () => {
  const result = evaluateCandidateRelevance({
    ...organicBase,
    url: 'https://test3.example.jp/company/',
  })
  assert.equal(result.status, 'rejected')
})

test('redirect to a booking or directory service is not an official HP', () => {
  const result = evaluateCandidateRelevance({
    url: 'https://example.jp/',
    industry: '美容室',
    keywords: ['美容室'],
    area: '渋谷区',
    source: 'places',
    sourceAddress: '東京都渋谷区神南1-1-1',
    sourceCategory: '美容室',
    redirectedToNonOfficial: true,
  })
  assert.equal(result.status, 'rejected')
  assert.ok(result.reasons.includes('unverified_official_site'))
})

test('station and distance labels are rejected rather than widened', () => {
  assert.equal(validateAreaInput('渋谷駅').valid, false)
  assert.equal(validateAreaInput('渋谷駅周辺').valid, false)
  assert.equal(validateAreaInput('半径5km').valid, false)
  assert.deepEqual(validateAreaInput('大阪'), { valid: true, normalized: '大阪府' })
})
