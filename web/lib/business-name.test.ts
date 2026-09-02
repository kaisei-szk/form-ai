import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractCompanyPageLinks,
  extractOfficialBusinessName,
  isSuspiciousBusinessName,
} from './business-name.ts'

test('flags only clearly broken business display names', () => {
  for (const name of [
    '会社概要',
    'お問い合わせ',
    'Contact Us',
    '会社概要 | サンプル',
    'エクシードジャパンのロゴ画像',
    'ワンダーグループ｜コーポレートサイト',
    '株式会社トップトラベルサービス 〜 新しい旅の楽しみを。',
  ]) {
    assert.equal(isSuspiciousBusinessName(name), true, name)
  }
  for (const name of ['株式会社サンプル', 'HAIR SALON X', '渋谷美容室 Lino']) {
    assert.equal(isSuspiciousBusinessName(name), false, name)
  }
})

test('prefers JSON-LD legalName over page headings and titles', () => {
  const html = `
    <html><head><title>お問い合わせ | Example</title></head><body>
    <script type="application/ld+json">
      {"@type":"Organization","name":"Example","legalName":"株式会社Example"}
    </script>
    </body></html>`
  assert.deepEqual(extractOfficialBusinessName(html), {
    name: '株式会社Example',
    source: 'jsonld_legal_name',
    score: 145,
  })
})

test('extracts the formal name beside a company profile label', () => {
  const html = `
    <title>会社概要</title>
    <dl><dt>会社名</dt><dd>株式会社リメディー</dd></dl>`
  assert.deepEqual(extractOfficialBusinessName(html), {
    name: '株式会社リメディー',
    source: 'company_label',
    score: 137,
  })
})

test('falls back to official site name for a store without a legal entity suffix', () => {
  const html = '<meta property="og:site_name" content="渋谷ヘアサロン Lino"><title>お問い合わせ</title>'
  assert.equal(extractOfficialBusinessName(html)?.name, '渋谷ヘアサロン Lino')
})

test('finds same-origin company profile pages only', () => {
  const html = `
    <a href="/company/">会社概要</a>
    <a href="https://outside.example/company">会社情報</a>
    <a href="/contact/">お問い合わせ</a>`
  assert.deepEqual(extractCompanyPageLinks(html, 'https://example.jp/service'), ['https://example.jp/company/'])
})
