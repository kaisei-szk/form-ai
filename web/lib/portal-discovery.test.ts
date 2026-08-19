import assert from 'node:assert/strict'
import test from 'node:test'
import {
  businessDedupeKey,
  domainMatchesBusinessName,
  extractBusinessesFromHtml,
  extractDetailLinks,
  isShallowSiteUrl,
} from './portal-discovery.ts'

test('JSON-LD business entries are extracted with official links', () => {
  const html = `
    <html><head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "HairSalon",
      "name": "サロンA【渋谷】",
      "address": { "@type": "PostalAddress", "addressRegion": "東京都", "addressLocality": "渋谷区", "streetAddress": "神南1-1-1" },
      "telephone": "03-1111-2222",
      "url": "https://salon-a.example.jp/",
      "sameAs": ["https://www.instagram.com/salon_a/"]
    }
    </script>
    </head><body></body></html>`
  const businesses = extractBusinessesFromHtml(html, 'https://beauty.hotpepper.jp/slnH000000001/')
  assert.equal(businesses.length, 1)
  assert.equal(businesses[0].name, 'サロンA【渋谷】')
  assert.equal(businesses[0].address, '東京都渋谷区神南1-1-1')
  assert.equal(businesses[0].officialUrl, 'https://salon-a.example.jp/')
  assert.equal(businesses[0].portalHost, 'beauty.hotpepper.jp')
})

test('portal detail URL in JSON-LD is not treated as an official site', () => {
  const html = `
    <script type="application/ld+json">
    { "@type": "HairSalon", "name": "サロンB", "telephone": "03-3333-4444",
      "url": "https://beauty.hotpepper.jp/slnH000000002/" }
    </script>`
  const businesses = extractBusinessesFromHtml(html, 'https://beauty.hotpepper.jp/slnH000000002/')
  assert.equal(businesses.length, 1)
  assert.equal(businesses[0].officialUrl, null)
})

test('ItemList JSON-LD yields every listed business', () => {
  const html = `
    <script type="application/ld+json">
    { "@type": "ItemList", "itemListElement": [
      { "@type": "ListItem", "position": 1, "item": { "@type": "BeautySalon", "name": "サロンC", "address": "東京都渋谷区宇田川町1-1" } },
      { "@type": "ListItem", "position": 2, "item": { "@type": "BeautySalon", "name": "サロンD", "telephone": "03-5555-6666" } }
    ] }
    </script>`
  const businesses = extractBusinessesFromHtml(html, 'https://portal.example.com/list')
  assert.deepEqual(businesses.map((b) => b.name), ['サロンC', 'サロンD'])
})

test('HTML fallback extracts name, address, phone and official link', () => {
  const html = `
    <html><head><title>サロンE｜渋谷の美容室ポータル</title></head>
    <body>
      <p>住所: 東京都渋谷区道玄坂2-2-2 ビル3F</p>
      <p>TEL: 03-7777-8888</p>
      <a href="https://salon-e.example.jp/">公式サイトはこちら</a>
    </body></html>`
  const businesses = extractBusinessesFromHtml(html, 'https://portal.example.com/shops/salon-e')
  assert.equal(businesses.length, 1)
  assert.equal(businesses[0].name, 'サロンE')
  assert.ok(businesses[0].address.startsWith('東京都渋谷区道玄坂'))
  assert.equal(businesses[0].officialUrl, 'https://salon-e.example.jp/')
})

test('a listing article is split into individual businesses instead of being saved as one company', () => {
  const html = `
    <html><head><title>渋谷区のSNS運用代行会社15社をプロが厳選 | 比較メディア</title></head><body>
      <h1>渋谷区のSNS運用代行会社15社をプロが厳選</h1>
      <h2>おすすめ企業一覧</h2>
      <h3>株式会社アルファ</h3>
      <p>SNS運用代行を提供しています。</p>
      <table><tr><th>URL</th><td><a href="https://alpha.example.jp/service/">公式サイト</a></td></tr>
      <tr><th>TEL</th><td>03-1111-2222</td></tr>
      <tr><th>会社所在地</th><td>東京都渋谷区神南1-1-1</td></tr></table>
      <h3>株式会社ベータ</h3>
      <p>企業SNSの運用を支援します。</p>
      <table><tr><th>URL</th><td><a href="https://beta.example.jp/">公式サイト</a></td></tr>
      <tr><th>所在地</th><td>東京都渋谷区道玄坂2-2-2</td></tr></table>
      <h2>関連する記事</h2>
      <a href="https://another-media.example.jp/posts/ranking">関連記事</a>
    </body></html>`

  const businesses = extractBusinessesFromHtml(html, 'https://portal.example.jp/posts/shibuya-sns')
  assert.deepEqual(businesses.map((business) => business.name), ['株式会社アルファ', '株式会社ベータ'])
  assert.deepEqual(businesses.map((business) => business.officialUrl), [
    'https://alpha.example.jp/service/',
    'https://beta.example.jp/',
  ])
})

test('a listing article title is never emitted as an unresolved business', () => {
  const html = `<html><head><title>東京都のSNS運用代行会社15社をプロが厳選</title></head>
    <body><p>掲載企業 TEL 03-6455-3088</p><p>東京都渋谷区円山町19-1</p></body></html>`
  assert.deepEqual(extractBusinessesFromHtml(html, 'https://portal.example.jp/posts/sns-tokyo'), [])
})

test('postal codes and partial numbers are not accepted as phone numbers', () => {
  const html = `<html><head><title>株式会社ガンマ</title></head>
    <body><p>〒003-0002 北海道札幌市白石区東札幌2条4丁目9-2</p></body></html>`
  const businesses = extractBusinessesFromHtml(html, 'https://portal.example.jp/companies/gamma')
  assert.equal(businesses.length, 1)
  assert.equal(businesses[0].phone, '')
})

test('detail links are the dominant repeated same-host pattern', () => {
  const anchors = Array.from({ length: 12 }, (_, i) => `<a href="/shops/salon-${i}/detail${i}">salon ${i}</a>`).join('')
  const html = `<html><body>
    ${anchors}
    <a href="/about">運営会社</a>
    <a href="/terms">利用規約</a>
    <a href="https://other.example.com/x">外部</a>
  </body></html>`
  const links = extractDetailLinks(html, 'https://portal.example.com/list')
  assert.equal(links.length, 12)
  assert.ok(links.every((link) => link.includes('/shops/')))
})

test('related article links are not mistaken for business detail pages', () => {
  const anchors = Array.from({ length: 12 }, (_, i) => `<a href="/posts/article-${i}">article ${i}</a>`).join('')
  assert.deepEqual(extractDetailLinks(`<body>${anchors}</body>`, 'https://portal.example.com/posts/list'), [])
})

test('the same business found on two portals dedupes by phone', () => {
  const a = businessDedupeKey('株式会社サロンF', '03-1234-5678', '東京都渋谷区1-1')
  const b = businessDedupeKey('サロンF 渋谷店', '0312345678', '')
  assert.equal(a, b)
})

test('without phones the dedupe key uses normalized name and address', () => {
  const a = businessDedupeKey('サロンG【シブヤ】', '', '東京都渋谷区神南1-1-1')
  const b = businessDedupeKey('サロンG', '', '東京都 渋谷区 神南1-1-1')
  assert.equal(a, b)
})

test('official-site research prefers shallow root-level URLs', () => {
  assert.ok(isShallowSiteUrl('https://kotona1010.com/'))
  assert.ok(isShallowSiteUrl('https://cee-salon.com/menu'))
  assert.ok(!isShallowSiteUrl('https://kumapon.jp/shops/34198/deals?src=x'))
  assert.ok(!isShallowSiteUrl('https://barbernavi.com/review/barbershopid-3218/'))
  assert.ok(!isShallowSiteUrl('https://e-hairsalons.com/shop/?004467'))
  assert.ok(!isShallowSiteUrl('https://modeca.net/salon.html&id=2302'))
})

test('deep URLs are only official when the domain carries the business name', () => {
  assert.ok(domainMatchesBusinessName('kenje-group.co.jp', 'KENJE HOMME SHIBUYA［ケンジオムシブヤ］'))
  assert.ok(!domainMatchesBusinessName('giftpost.jp', 'WYETH HAIR SALON'))
  assert.ok(!domainMatchesBusinessName('e-hairsalons.com', 'Hair salon arch'))
  assert.ok(!domainMatchesBusinessName('zdh.co.jp', 'ジール'))
})
