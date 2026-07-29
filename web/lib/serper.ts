// 都道府県→市区町村展開マップ
export const PREF_DISTRICTS: Record<string, string[]> = {
  '東京都': [
    '千代田区','中央区','港区','新宿区','文京区','台東区','墨田区','江東区',
    '品川区','目黒区','大田区','世田谷区','渋谷区','中野区','杉並区','豊島区',
    '北区','荒川区','板橋区','練馬区','足立区','葛飾区','江戸川区',
    '八王子市','立川市','武蔵野市','三鷹市','青梅市','府中市','昭島市',
    '調布市','町田市','小金井市','小平市','日野市','東村山市','国分寺市',
    '国立市','福生市','狛江市','東大和市','清瀬市','東久留米市','武蔵村山市',
    '多摩市','稲城市','羽村市','あきる野市','西東京市',
  ],
  '大阪府': [
    '大阪市北区','大阪市中央区','大阪市西区','大阪市浪速区','大阪市天王寺区',
    '大阪市淀川区','大阪市東淀川区','大阪市東成区','大阪市生野区','大阪市旭区',
    '大阪市城東区','大阪市鶴見区','大阪市阿倍野区','大阪市住之江区','大阪市住吉区',
    '大阪市東住吉区','大阪市平野区','大阪市西成区',
    '堺市堺区','堺市北区','堺市中区','堺市東区','堺市西区','堺市南区',
    '豊中市','吹田市','高槻市','茨木市','枚方市','寝屋川市','東大阪市',
    '八尾市','松原市','大東市','和泉市','箕面市','守口市','門真市',
  ],
  '神奈川県': [
    '横浜市西区','横浜市中区','横浜市南区','横浜市港南区','横浜市保土ケ谷区',
    '横浜市旭区','横浜市磯子区','横浜市金沢区','横浜市港北区','横浜市緑区',
    '横浜市青葉区','横浜市都筑区','横浜市鶴見区','横浜市神奈川区','横浜市戸塚区',
    '横浜市栄区','横浜市泉区','横浜市瀬谷区',
    '川崎市川崎区','川崎市幸区','川崎市中原区','川崎市高津区','川崎市多摩区',
    '川崎市宮前区','川崎市麻生区',
    '相模原市緑区','相模原市中央区','相模原市南区',
    '横須賀市','平塚市','鎌倉市','藤沢市','小田原市','茅ヶ崎市','厚木市','大和市',
  ],
  '愛知県': [
    '名古屋市中区','名古屋市東区','名古屋市西区','名古屋市北区','名古屋市昭和区',
    '名古屋市瑞穂区','名古屋市熱田区','名古屋市中村区','名古屋市中川区','名古屋市港区',
    '名古屋市南区','名古屋市守山区','名古屋市緑区','名古屋市名東区','名古屋市天白区',
    '豊田市','豊橋市','岡崎市','一宮市','春日井市','豊川市','刈谷市','安城市','西尾市',
  ],
  '福岡県': [
    '福岡市東区','福岡市博多区','福岡市中央区','福岡市南区','福岡市西区',
    '福岡市城南区','福岡市早良区',
    '北九州市門司区','北九州市小倉北区','北九州市小倉南区','北九州市若松区',
    '北九州市八幡東区','北九州市八幡西区','北九州市戸畑区',
    '久留米市','飯塚市','春日市','大野城市','宗像市','糸島市','筑紫野市',
  ],
  '兵庫県': [
    '神戸市東灘区','神戸市灘区','神戸市兵庫区','神戸市長田区','神戸市須磨区',
    '神戸市垂水区','神戸市北区','神戸市中央区','神戸市西区',
    '姫路市','尼崎市','明石市','西宮市','芦屋市','伊丹市','宝塚市','川西市','三田市',
  ],
  '埼玉県': [
    'さいたま市西区','さいたま市北区','さいたま市大宮区','さいたま市見沼区',
    'さいたま市中央区','さいたま市桜区','さいたま市浦和区','さいたま市南区',
    'さいたま市緑区','さいたま市岩槻区',
    '川越市','熊谷市','川口市','行田市','所沢市','加須市','春日部市','狭山市',
    '上尾市','草加市','越谷市','蕨市','戸田市','入間市','朝霞市','志木市','和光市',
    '新座市','桶川市','久喜市','北本市','鴻巣市','蓮田市','坂戸市','幸手市',
  ],
  '千葉県': [
    '千葉市中央区','千葉市花見川区','千葉市稲毛区','千葉市若葉区','千葉市緑区','千葉市美浜区',
    '市川市','船橋市','松戸市','野田市','柏市','市原市','流山市','八千代市',
    '我孫子市','鎌ケ谷市','浦安市','四街道市','習志野市','佐倉市','木更津市',
  ],
  '京都府': [
    '京都市北区','京都市上京区','京都市左京区','京都市中京区','京都市東山区',
    '京都市山科区','京都市下京区','京都市南区','京都市右京区','京都市西京区',
    '京都市伏見区',
    '宇治市','亀岡市','向日市','長岡京市','八幡市','京田辺市','木津川市',
  ],
  '北海道': [
    '札幌市中央区','札幌市北区','札幌市東区','札幌市白石区','札幌市豊平区',
    '札幌市南区','札幌市西区','札幌市厚別区','札幌市手稲区','札幌市清田区',
    '旭川市','函館市','釧路市','帯広市','北見市','苫小牧市','小樽市',
    '江別市','千歳市','恵庭市',
  ],
  '青森県': ['青森市','弘前市','八戸市','十和田市','むつ市','五所川原市','三沢市'],
  '岩手県': ['盛岡市','花巻市','北上市','奥州市','一関市','宮古市','釜石市'],
  '宮城県': [
    '仙台市青葉区','仙台市宮城野区','仙台市若林区','仙台市太白区','仙台市泉区',
    '石巻市','大崎市','気仙沼市','塩竈市','名取市','多賀城市','登米市',
  ],
  '秋田県': ['秋田市','横手市','大仙市','能代市','由利本荘市','湯沢市','男鹿市'],
  '山形県': ['山形市','鶴岡市','酒田市','天童市','上山市','米沢市','新庄市'],
  '福島県': ['福島市','郡山市','いわき市','会津若松市','白河市','須賀川市','喜多方市','二本松市'],
  '茨城県': [
    '水戸市','つくば市','日立市','土浦市','古河市','取手市','牛久市',
    'ひたちなか市','龍ケ崎市','守谷市','常総市','筑西市',
  ],
  '栃木県': ['宇都宮市','小山市','栃木市','足利市','佐野市','鹿沼市','日光市','那須塩原市'],
  '群馬県': ['前橋市','高崎市','太田市','伊勢崎市','桐生市','渋川市','藤岡市','富岡市'],
  '新潟県': [
    '新潟市中央区','新潟市東区','新潟市江南区','新潟市秋葉区',
    '長岡市','上越市','燕市','三条市','柏崎市','新発田市',
  ],
  '富山県': ['富山市','高岡市','射水市','魚津市','砺波市','小矢部市'],
  '石川県': ['金沢市','白山市','小松市','加賀市','七尾市','輪島市'],
  '福井県': ['福井市','敦賀市','越前市','坂井市','鯖江市','大野市'],
  '山梨県': ['甲府市','富士吉田市','甲斐市','笛吹市','中央市','都留市'],
  '長野県': ['長野市','松本市','上田市','岡谷市','飯田市','諏訪市','茅野市','塩尻市'],
  '岐阜県': ['岐阜市','大垣市','各務原市','可児市','多治見市','羽島市','美濃加茂市'],
  '静岡県': [
    '静岡市葵区','静岡市駿河区','静岡市清水区',
    '浜松市中区','浜松市東区','浜松市西区',
    '沼津市','富士市','磐田市','焼津市','掛川市','藤枝市','袋井市','富士宮市',
  ],
  '三重県': ['津市','四日市市','伊勢市','松阪市','桑名市','鈴鹿市','名張市','亀山市'],
  '滋賀県': ['大津市','草津市','彦根市','長浜市','近江八幡市','守山市','栗東市','甲賀市'],
  '奈良県': ['奈良市','橿原市','生駒市','大和郡山市','天理市','桜井市','香芝市'],
  '和歌山県': ['和歌山市','海南市','橋本市','有田市','田辺市','新宮市'],
  '鳥取県': ['鳥取市','米子市','倉吉市','境港市'],
  '島根県': ['松江市','出雲市','浜田市','益田市','大田市'],
  '岡山県': [
    '岡山市北区','岡山市中区','岡山市東区','岡山市南区',
    '倉敷市','津山市','玉野市','笠岡市','総社市','赤磐市',
  ],
  '広島県': [
    '広島市中区','広島市東区','広島市南区','広島市西区',
    '広島市安佐南区','広島市安佐北区','広島市佐伯区','広島市安芸区',
    '福山市','呉市','東広島市','尾道市','廿日市市',
  ],
  '山口県': ['山口市','下関市','宇部市','周南市','防府市','岩国市','光市'],
  '徳島県': ['徳島市','阿南市','鳴門市','吉野川市'],
  '香川県': ['高松市','丸亀市','坂出市','善通寺市','観音寺市'],
  '愛媛県': ['松山市','今治市','新居浜市','西条市','四国中央市','宇和島市'],
  '高知県': ['高知市','南国市','四万十市','香南市'],
  '佐賀県': ['佐賀市','唐津市','鳥栖市','伊万里市'],
  '長崎県': ['長崎市','佐世保市','諫早市','大村市','島原市'],
  '熊本県': [
    '熊本市中央区','熊本市東区','熊本市西区','熊本市南区','熊本市北区',
    '八代市','玉名市','菊池市','宇土市','合志市',
  ],
  '大分県': ['大分市','別府市','中津市','佐伯市','日田市','杵築市'],
  '宮崎県': ['宮崎市','都城市','延岡市','日南市','小林市','日向市'],
  '鹿児島県': ['鹿児島市','霧島市','薩摩川内市','姶良市','鹿屋市','出水市','指宿市'],
  '沖縄県': ['那覇市','沖縄市','浦添市','うるま市','宜野湾市','豊見城市','名護市','糸満市'],
}

export function expandArea(area: string): string[] {
  const isPref = area.endsWith('都') || area.endsWith('道') || area.endsWith('府') || area.endsWith('県')
  if (isPref && PREF_DISTRICTS[area]) return PREF_DISTRICTS[area]
  return [area]
}

export type SerperItem = {
  title: string
  link:  string
  snippet?: string
}

export type SerperResultItem = {
  link: string
  title: string
  snippet: string
  keyword: string
  area: string
}

export type SerperSearchStats = {
  queriesUsed: number
  directFound: number      // 直接検索で見つかった公式HP数
  portalNames: number      // ポータルから抽出した店舗・企業名の数
  lookupFound: number      // 店舗名の逆引き検索で見つかった公式HP数
  subAreas: string[]       // 使用したサブエリア(駅名・町名)一覧
  timedOut: boolean        // 時間/クエリ予算で途中終了したか
}

export const DEFAULT_SUFFIXES = ['お問い合わせ', '公式サイト', 'contact', '予約', '申込み']

// ポータル・SNS・アグリゲータドメイン — 最終結果から除外(公式HPではない)
const SKIP_DOMAINS = new Set([
  'jalan.net','tabelog.com','hotpepper.jp','ekiten.jp','townpage.ntt.co.jp',
  'navitime.co.jp','navitime.jp','mapion.co.jp','its-mo.com',
  'yelp.com','yelp.co.jp','retty.me','gurunavi.com','gnavi.co.jp',
  'google.com','google.co.jp','facebook.com','instagram.com','twitter.com','x.com',
  'youtube.com','wikipedia.org','linkedin.com','tiktok.com',
  'recruit.co.jp','indeed.com','wantedly.com','yahoo.co.jp',
  'rakuten.co.jp','amazon.co.jp',
  'beauty.hotpepper.jp','minimo.io','hairbook.jp','riyou.jp',
  'epark.jp','homemate-research.com','zehitomo.com','baseconnect.in',
  // ポータル逆引きの発見源にも使うディレクトリ系(結果には含めない)
  'itp.ne.jp','caloo.jp','byoinnavi.jp','fdoc.jp','hospita.jp','qlife.jp',
  'ozmall.co.jp','beauty.rakuten.co.jp','haisha-yoyaku.jp','eparkdentist.com',
  'oshiete.goo.ne.jp','chiebukuro.yahoo.co.jp','note.com','ameblo.jp',
  'prtimes.jp','mynavi.jp','townwork.net','baitoru.com','hatarako.net',
])

// 店舗・企業名の「発見源」として使うディレクトリ型ポータル。
// どの業種・地域でも通用する汎用リスト(業種特化のものは検索結果が空になるだけでコスト僅少)
const PORTAL_DIRECTORY_HOSTS = [
  'itp.ne.jp',            // iタウンページ — 全業種を網羅する電話帳
  'ekiten.jp',            // エキテン — 全業種の店舗ポータル
  'beauty.hotpepper.jp',  // 美容室・サロン・エステ
  'hotpepper.jp',         // 飲食
  'epark.jp',             // 医療・美容・リラク
  'caloo.jp',             // 病院・クリニック口コミ
  'byoinnavi.jp',         // 病院なび
  'tabelog.com',          // 飲食
  'homemate-research.com',// 施設全般
  'ozmall.co.jp',         // 美容・サロン予約
  'beauty.rakuten.co.jp', // 楽天ビューティー
]

// ポータルのタイトルからブランド名部分を除去するためのパターン
const PORTAL_BRAND_RE = /ホットペッパー|hot\s*pepper|エキテン|ekiten|EPARK|イーパーク|食べログ|tabelog|caloo|カルー|病院なび|びょういんなび|タウンページ|ozmall|オズモール|minimo|ミニモ|楽天ビューティ|rakuten|ホームメイト|homemate|navitime|ナビタイム|口コミ|ネット受付|ネット予約|WEB予約|求人/i
// 店舗名として不適切な文字列(一覧・特集ページのタイトル等)
const NAME_REJECT_RE = /一覧|ランキング|おすすめ|オススメ|まとめ|比較|特集|検索|人気|徹底|ガイド|とは|方法|求人|募集|アクセス|地図|マップ|近く|周辺|エリア|\d+[件選店院]|ベスト\d+|TOP\d+|top\d+/i

function extractHost(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/)
  return m ? m[1].replace(/^www\./, '') : ''
}

function isSkipHost(host: string): boolean {
  return SKIP_DOMAINS.has(host) || [...SKIP_DOMAINS].some((d) => host.endsWith('.' + d))
}

function isPortalHost(host: string): boolean {
  return PORTAL_DIRECTORY_HOSTS.some((d) => host === d || host.endsWith('.' + d))
}

/**
 * ポータル検索結果のタイトルから店舗・企業名を抽出する。
 * 例: 「ヘアサロン○○(渋谷)|ホットペッパービューティー」→「ヘアサロン○○」
 *     「○○クリニック(東京都渋谷区) - 口コミ・評判 | Caloo」→「○○クリニック」
 */
export function extractBusinessName(title: string): string | null {
  if (!title) return null
  // 【公式】【予約可】等の装飾を除去
  const stripped = title.replace(/【[^】]*】/g, ' ').trim()
  // 区切り文字で分割し、ポータルブランド名を含まない最初のセグメントを採用
  const parts = stripped
    .split(/[|｜]|(?:\s+[-–—−]\s+)|(?:\s+\/\s+)|(?:\s+･\s+)/)
    .map((s) => s.trim())
    .filter(Boolean)
  let cand = parts.find((p) => !PORTAL_BRAND_RE.test(p)) ?? ''
  // 末尾の (渋谷) (東京都渋谷区) 等の括弧書きを除去
  cand = cand.replace(/[（(][^）)]*[）)]\s*$/, '').trim()
  // 先頭括弧のみ残った断片も除去
  cand = cand.replace(/^[（(][^）)]*[）)]\s*/, '').trim()
  if (cand.length < 3 || cand.length > 40) return null
  if (NAME_REJECT_RE.test(cand)) return null
  if (PORTAL_BRAND_RE.test(cand)) return null
  return cand
}

/** 店舗名の照合用正規化(空白・記号を除去) */
function normalizeName(s: string): string {
  return s.replace(/[\s　・･'"「」『』〈〉《》]/g, '').toLowerCase()
}

// ── サブエリア(駅名・町名)のAI展開 ─────────────────────────────
// 市区町村より細かい粒度にクエリを分割することで、Google検索の
// 「1クエリあたり実質数十件」の上限を突破する。どのエリアでも
// GPTがその場で駅名・町名を生成するため、地域特化の辞書は不要。
const _subAreaCache = new Map<string, string[]>()

export async function aiExpandSubAreas(area: string, maxSubAreas = 12): Promise<string[]> {
  const cached = _subAreaCache.get(area)
  if (cached) return cached

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return []

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '日本の地理に詳しいアシスタントです。JSONのみ返してください。' },
          {
            role: 'user',
            content: `「${area}」(日本)の中にある主要な駅名・町名・エリア名を最大${maxSubAreas}個挙げてください。
【ルール】
1. 必ず「${area}」の内部にある地名のみ(隣接エリアはNG)
2. Google検索の地名として使える短い名称のみ(「駅」は付けない。例: 恵比寿、代官山)
3. 店舗が多い順に並べる
4. 該当がない小さな自治体の場合は空配列でよい
JSON: {"subareas": ["..."]}`,
          },
        ],
      }),
    })
    if (!res.ok) return []
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as { subareas?: unknown }
    if (!Array.isArray(parsed.subareas)) return []
    const subs = parsed.subareas
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 15 && s !== area)
      .slice(0, maxSubAreas)
    _subAreaCache.set(area, subs)
    return subs
  } catch {
    return []
  }
}

// ── 検索本体 ───────────────────────────────────────────────
const CONCURRENCY = 12
const DEFAULT_MAX_QUERIES = 2200
const DEFAULT_TIME_BUDGET_MS = 240_000  // Vercel maxDuration=300s に対し余裕を持たせる
const TARGET_NAMES = 1500               // ポータルから抽出する店舗名の目標数

type SearchCtx = {
  apiKey: string
  maxQueries: number
  deadline: number
  queriesUsed: number
  consecutiveErrors: number
  lastError: { status: number; text: string } | null
  aborted: boolean
  seenUrls: Set<string>
  seenHosts: Set<string>
  results: SerperResultItem[]
  // 店舗名 → 発見時のキーワード/サブエリア
  names: Map<string, { kw: string; subArea: string }>
  stats: { directFound: number; lookupFound: number }
}

function budgetLeft(ctx: SearchCtx): boolean {
  return !ctx.aborted && ctx.queriesUsed < ctx.maxQueries && Date.now() < ctx.deadline
}

/** Serper 1リクエスト。429/一時エラーは1回リトライ。連続エラーが続いたら全体を中断 */
async function serperFetch(ctx: SearchCtx, q: string, page: number): Promise<SerperItem[] | null> {
  if (!budgetLeft(ctx)) return null
  ctx.queriesUsed++
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': ctx.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, gl: 'jp', hl: 'ja', num: 10, page }),
      })
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200))
        continue
      }
      if (!res.ok) {
        ctx.lastError = { status: res.status, text: await res.text() }
        ctx.consecutiveErrors++
        if (ctx.consecutiveErrors >= 5) ctx.aborted = true
        return null
      }
      const data = await res.json() as { error?: string; organic?: SerperItem[] }
      ctx.consecutiveErrors = 0
      if (data.error) return []
      return data.organic ?? []
    } catch (e) {
      ctx.lastError = { status: 0, text: String(e) }
      ctx.consecutiveErrors++
      if (ctx.consecutiveErrors >= 5) { ctx.aborted = true; return null }
      await new Promise((r) => setTimeout(r, 800))
    }
  }
  return null
}

/** 検索結果1件を取り込む。公式HP候補なら結果に追加、ポータルなら店舗名を収穫。戻り値=新規獲得数 */
function ingestItem(ctx: SearchCtx, item: SerperItem, kw: string, subArea: string): number {
  if (!item.link || ctx.seenUrls.has(item.link)) return 0
  ctx.seenUrls.add(item.link)
  const host = extractHost(item.link)
  if (!host) return 0

  if (isPortalHost(host)) {
    // ポータル → 店舗名を抽出して逆引き対象に(結果には含めない)
    const name = extractBusinessName(item.title || '')
    if (name && !ctx.names.has(name)) {
      ctx.names.set(name, { kw, subArea })
      return 1
    }
    return 0
  }
  if (isSkipHost(host)) return 0
  if (ctx.seenHosts.has(host)) return 0

  ctx.seenHosts.add(host)
  ctx.results.push({
    link: item.link, title: item.title || '', snippet: item.snippet || '',
    keyword: kw, area: subArea,
  })
  ctx.stats.directFound++
  return 1
}

type QueryChain = { query: string; kw: string; subArea: string; maxPages: number }

/** 1クエリを新規獲得が止まるまでページ送り(早期打ち切りでAPI予算を節約) */
async function runChain(ctx: SearchCtx, chain: QueryChain): Promise<void> {
  for (let page = 1; page <= chain.maxPages; page++) {
    if (!budgetLeft(ctx)) return
    const items = await serperFetch(ctx, chain.query, page)
    if (items === null || items.length === 0) return
    let gained = 0
    for (const item of items) gained += ingestItem(ctx, item, chain.kw, chain.subArea)
    // このページで新規(公式HP or 店舗名)がゼロなら以降のページも重複ばかり → 打ち切り
    if (gained === 0) return
  }
}

/** シンプルな並列プール */
async function runPool<T>(jobs: T[], worker: (job: T) => Promise<void>, stop: () => boolean): Promise<void> {
  let i = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (i < jobs.length && !stop()) {
      const job = jobs[i++]
      await worker(job)
    }
  })
  await Promise.all(runners)
}

/**
 * 多段階Serper検索:
 *  Stage 1: エリアをAIで駅名・町名に細分化(汎用)
 *  Stage 2: キーワード×サブエリア×サフィックスの直接検索(新規が出なくなったページで打ち切り)
 *  Stage 3: ポータルサイト(タウンページ・ホットペッパー等)から店舗名を列挙
 *  Stage 4: 店舗名ごとに「店舗名 エリア」で逆引き検索して公式HPを特定
 * ポータルは地域の店舗をほぼ網羅しているため、Google検索単体の
 * 「上位数十件しか取れない」限界を超えて母集団を確保できる。
 */
export async function runSerperSearch(params: {
  keywords: string[]
  area: string
  suffixes?: string[]
  keywordMode?: 'or' | 'and'
  apiKey: string
  maxQueries?: number
  timeBudgetMs?: number
}): Promise<{ items: SerperResultItem[]; stats: SerperSearchStats; error?: { status: number; text: string } }> {
  const { keywords, area, suffixes, keywordMode, apiKey } = params
  const SUFFIXES = (suffixes && suffixes.length > 0) ? suffixes : DEFAULT_SUFFIXES
  const keywordGroups = (keywordMode === 'and' && keywords.length > 0) ? [keywords.join(' ')] : keywords

  const ctx: SearchCtx = {
    apiKey,
    maxQueries: params.maxQueries ?? DEFAULT_MAX_QUERIES,
    deadline: Date.now() + (params.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS),
    queriesUsed: 0,
    consecutiveErrors: 0,
    lastError: null,
    aborted: false,
    seenUrls: new Set(),
    seenHosts: new Set(),
    results: [],
    names: new Map(),
    stats: { directFound: 0, lookupFound: 0 },
  }
  const stop = () => !budgetLeft(ctx)

  // ── Stage 1: サブエリア展開 ──
  const subAreas = await aiExpandSubAreas(area)
  const allAreas = [area, ...subAreas]

  // ── Stage 2: 直接検索 ──
  // サブエリアがある場合はページ数を抑え、クエリの多様性に予算を回す
  const directPages = allAreas.length > 1 ? 4 : 10
  const directChains: QueryChain[] = []
  for (const kw of keywordGroups) {
    for (const subArea of allAreas) {
      for (const suffix of SUFFIXES) {
        directChains.push({
          query: suffix ? `${kw} ${subArea} ${suffix}` : `${kw} ${subArea}`,
          kw, subArea, maxPages: directPages,
        })
      }
    }
  }
  await runPool(directChains, (c) => runChain(ctx, c), stop)

  // ── Stage 3: ポータル列挙(店舗名の収穫) ──
  // まずエリア全体で各ポータルを深掘り。名前が足りなければサブエリア単位でも実行
  const portalChainsWide: QueryChain[] = []
  for (const portal of PORTAL_DIRECTORY_HOSTS) {
    for (const kw of keywordGroups) {
      portalChainsWide.push({ query: `site:${portal} ${kw} ${area}`, kw, subArea: area, maxPages: 10 })
    }
  }
  await runPool(portalChainsWide, (c) => runChain(ctx, c), stop)

  if (ctx.names.size < TARGET_NAMES && subAreas.length > 0 && budgetLeft(ctx)) {
    const portalChainsNarrow: QueryChain[] = []
    for (const portal of PORTAL_DIRECTORY_HOSTS) {
      for (const kw of keywordGroups) {
        for (const subArea of subAreas) {
          portalChainsNarrow.push({ query: `site:${portal} ${kw} ${subArea}`, kw, subArea, maxPages: 3 })
        }
      }
    }
    await runPool(portalChainsNarrow, (c) => runChain(ctx, c), () => stop() || ctx.names.size >= TARGET_NAMES)
  }

  // ── Stage 4: 店舗名の逆引き検索 → 公式HP特定 ──
  const lookupJobs = [...ctx.names.entries()]
  await runPool(lookupJobs, async ([name, meta]) => {
    if (!budgetLeft(ctx)) return
    const q = `${name} ${meta.subArea}`
    const items = await serperFetch(ctx, q, 1)
    if (!items) return
    const nameNorm = normalizeName(name)
    const namePrefix = nameNorm.slice(0, Math.min(5, nameNorm.length))
    for (const item of items) {
      if (!item.link) continue
      const host = extractHost(item.link)
      if (!host || isSkipHost(host) || isPortalHost(host) || ctx.seenHosts.has(host)) continue
      // タイトルに店舗名(先頭部分)が含まれることを要求 — 無関係サイトの誤登録を防ぐ
      const titleNorm = normalizeName(item.title || '')
      if (namePrefix && !titleNorm.includes(namePrefix)) continue
      ctx.seenHosts.add(host)
      ctx.seenUrls.add(item.link)
      ctx.results.push({
        link: item.link, title: item.title || '', snippet: item.snippet || '',
        keyword: meta.kw, area: meta.subArea,
      })
      ctx.stats.lookupFound++
      break
    }
  }, stop)

  const stats: SerperSearchStats = {
    queriesUsed: ctx.queriesUsed,
    directFound: ctx.stats.directFound,
    portalNames: ctx.names.size,
    lookupFound: ctx.stats.lookupFound,
    subAreas,
    timedOut: !budgetLeft(ctx) && !ctx.aborted,
  }

  if (ctx.aborted && ctx.lastError) {
    return { items: ctx.results, stats, error: ctx.lastError }
  }
  return { items: ctx.results, stats }
}
