/**
 * 業種の同義語辞書。検索キーワード展開と関連性判定の両方で共有する。
 * 特定の検索条件専用ではなく、代表的な業種の表記ゆれ・同義語を汎用に扱う。
 * 例: キーワード「美容室」と Google カテゴリ「美容院」を同一業種として突き合わせる。
 */
const SYNONYM_GROUPS: string[][] = [
  ['美容室', '美容院', 'ヘアサロン', 'ヘアーサロン', 'hair salon', 'ヘアデザイン'],
  ['理容室', '理容院', '理髪店', '床屋', 'バーバー', 'barber shop'],
  ['ヘッドスパ', 'head spa', 'ドライヘッドスパ', 'ヘッドマッサージ', 'スカルプケア'],
  ['ネイルサロン', 'nail salon', 'ネイル専門店'],
  ['まつげエクステ', 'マツエク', 'まつエク', 'アイラッシュサロン'],
  ['エステサロン', 'エステティックサロン', 'エステ'],
  ['リラクゼーションサロン', 'リラクゼーション', 'マッサージ店', 'もみほぐし'],
  ['整体院', '整体', 'カイロプラクティック', '整骨院', '接骨院'],
  ['人材紹介会社', '人材紹介', '職業紹介', '有料職業紹介', '転職エージェント', '人材エージェント', '転職支援'],
  ['人材派遣会社', '人材派遣', '労働者派遣', '派遣会社'],
  ['M&A仲介会社', 'M&A仲介', 'M&Aアドバイザリー', 'M&Aコンサルティング', 'M&A支援', '事業承継支援'],
  ['不動産会社', '不動産仲介', '不動産売買', '賃貸仲介', '不動産業'],
  ['歯科医院', '歯科', '歯医者', 'デンタルクリニック', '歯科クリニック'],
  ['税理士事務所', '税理士法人', '会計事務所'],
  ['法律事務所', '弁護士事務所', '弁護士法人'],
  ['行政書士事務所', '行政書士法人'],
  ['司法書士事務所', '司法書士法人'],
  ['学習塾', '進学塾', '個別指導塾'],
  ['フィットネスジム', 'スポーツジム', 'パーソナルジム', 'トレーニングジム', 'フィットネスクラブ'],
  ['動物病院', '獣医', 'ペットクリニック'],
  ['カフェ', '喫茶店', 'コーヒーショップ'],
  ['居酒屋', '酒場', 'ダイニングバー'],
  ['ホームページ制作会社', 'web制作会社', 'ウェブ制作会社', 'ホームページ制作', 'web制作'],
  ['広告代理店', '広告会社'],
  ['SNS運用代行会社', 'SNS運用代行', 'SNS運用支援', 'SNSアカウント運用', 'アカウント運用支援', 'SNSマーケティング会社', 'SNSマーケティング支援', 'ソーシャルメディア運用', 'ソーシャルメディアマーケティング', 'Instagram運用代行', 'Instagram運用支援', 'TikTok運用代行', 'TikTok運用支援', 'X運用代行'],
  ['ハウスクリーニング', '清掃業者', '清掃会社'],
  ['リフォーム会社', 'リフォーム業者', '住宅リフォーム'],
  ['介護施設', '介護事業所', 'デイサービス', '老人ホーム'],
  ['保育園', '保育所', 'こども園'],
]

function normalizeTerm(term: string): string {
  return term.normalize('NFKC').toLowerCase().replace(/[\s　・･]/g, '')
}

const groupByNormalizedMember = new Map<string, string[]>()
for (const group of SYNONYM_GROUPS) {
  for (const member of group) groupByNormalizedMember.set(normalizeTerm(member), group)
}

export function findSynonymGroup(term: string): string[] | null {
  const normalized = normalizeTerm(term)
  if (!normalized) return null
  const exact = groupByNormalizedMember.get(normalized)
  if (exact) return exact
  for (const [member, group] of groupByNormalizedMember) {
    if (member.length >= 3 && normalized.includes(member)) return group
    if (normalized.length >= 3 && member.includes(normalized)) return group
  }
  return null
}

/** 入力語＋辞書上の同義語を、順序を保った重複なしの配列で返す。 */
export function expandIndustryTerms(terms: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (term: string) => {
    const normalized = normalizeTerm(term)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      out.push(term)
    }
  }
  for (const term of terms) {
    push(term)
    for (const synonym of findSynonymGroup(term) ?? []) push(synonym)
  }
  return out
}
