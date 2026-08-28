# 企業フォーム自動収集ツール

Serper のローカル検索と通常Web検索で地域・業種に適合する公式HPを収集し、各サイトからお問い合わせフォームのURLを自動探索するシステムです。地域・業種・公式サイトの根拠が揃わない候補は保存しません。

## システム構成

| コンポーネント | 役割 |
|---|---|
| **Next.js (web)** | ダッシュボードUI・APIサーバー |
| **n8n** | 検索・スクレイピング・AI判定のワークフロー実行エンジン |
| **Playwright Service** | フォーム送信用ブラウザ自動化サービス |
| **Serper API** | ローカル事業者・公式HP候補の取得 |
| **OpenAI GPT-4o-mini** | フォーム種別（問い合わせ vs 予約）の自動判定 |
| **Google Sheets** | 収集結果の永続ストレージ |

### 処理フロー

```
[ダッシュボード] → [n8n webhook]
  → L-01: 検索パラメータ設定
  → L-02: Serper で公式HP候補を独立検索語ごとに飽和まで収集
  → L-03: 地域・業種・公式HPの適合判定、フォームリンク抽出
  → L-04: GPT によるフォーム種別判定（問い合わせ/予約/不明）
  → L-05: 重複チェック（既存シートと照合）
  → L-06: Google Sheets に書き込み
  → 完了コールバック → UI のステータス更新
```

## セットアップ

### 必要なもの

- Docker / Docker Compose
- Serper API キー
- Google Cloud プロジェクト（Sheets API 有効化済み）
- OpenAI API キー
- Google サービスアカウント（Sheets 書き込み権限）

### 手順

**1. リポジトリをクローン**

```bash
git clone https://github.com/tao119/auto-form.git
cd auto-form
```

**2. 環境変数を設定**

```bash
cp .env.example .env
```

`.env` を開いて以下を記入します。

| 変数名 | 説明 |
|---|---|
| `SERPER_API_KEY` | Serper APIキー |
| `OPENAI_API_KEY` | OpenAI APIキー |
| `GOOGLE_SHEETS_ID` | 収集先スプレッドシートID（空白で自動作成） |
| `SHEETS_OWNER_EMAIL` | スプレッドシートを共有するGmailアドレス |
| `N8N_API_KEY` | n8n 起動後に発行するAPIキー（後述） |
| `N8N_WORKFLOW_ID` | n8n にインポートしたワークフローID（後述） |
| `SERPER_MAX_PAGES` | Placesの1検索語あたりの安全上限（既定50、2ページ連続飽和で早期終了） |
| `SERPER_PLACES_QUERY_LIMIT` | Placesへ投入する重複の少ない主要検索語数（既定12） |
| `SERPER_AREA_PARTITION_LIMIT` | 大規模地域を駅・街区へ分割する数（渋谷区は既定18） |
| `SERPER_PARTITION_KEYWORD_LIMIT` | 各地域分割へ投入する主要検索語数（既定3） |
| `SERPER_PLACES_TOTAL_QUERY_LIMIT` | 地域全体＋分割を合わせたPlaces独立クエリ上限（既定72） |
| `SERPER_ORGANIC_MAX_PAGES` | 通常Web検索の1検索語あたりの安全上限（既定20） |
| `SERPER_ORGANIC_QUERY_LIMIT` | 通常Web検索の独立クエリ総数上限（既定60、地域分割を含む） |
| `SERPER_TIME_BUDGET_MS` | 通常検索の時間予算（既定2700000ms＝45分） |
| `SERPER_PORTAL_TIME_BUDGET_MS` | ポータル列挙・公式HP再検索の時間予算（既定1800000ms＝30分） |
| `SERPER_CONCURRENCY` | Serper同時リクエスト数（既定5） |
| `HOTPEPPER_MAX_PAGES` | Hot Pepper対象業種で列挙する一覧ページ上限（既定150） |
| `HOTPEPPER_DETAIL_LIMIT` | 住所・電話を補完するHot Pepper店舗詳細の上限（既定2000） |
| `HOTPEPPER_FETCH_CONCURRENCY` | Hot Pepper公開ページの同時取得数（既定4） |
| `SERPER_PORTAL_RESEARCH_LIMIT` | ポータル掲載店舗の公式HP再検索上限（既定3000） |
| `SERPER_PRIOR_UNRESOLVED_LIMIT` | 次回実行へ自動再投入する未解決店舗数（既定2500） |
| `SERPER_RESOLUTION_MAX_ATTEMPTS` | 公式HPを再検索する最大実行回数（既定5） |
| `SERPER_HOLD_RETRY_LIMIT` | 次回実行へ自動再投入する保留中HP候補数（既定1000） |

**3. Google サービスアカウントを配置**

サービスアカウントのJSONキーファイルを `config/service-account.json` に置きます。

**4. コンテナを起動**

```bash
docker compose up -d
```

初回起動後、以下のURLにアクセスします。

| サービス | URL |
|---|---|
| ダッシュボード | http://localhost:3000 |
| n8n | http://localhost:5678 |

**5. n8n の初期設定**

1. http://localhost:5678 にアクセスしてアカウントを作成
2. 設定 → API Keys から APIキーを発行し、`.env` の `N8N_API_KEY` に記入
3. ワークフローを手動でインポート（`n8n/workflow.json`）するか、後述のスクリプトで自動デプロイ

n8n のワークフロー内で使用する環境変数（`SERPER_API_KEY`、`OPENAI_API_KEY` など）は、n8n の Variables 設定で登録するか、`docker-compose.yml` の `environment` 経由で渡します。

**6. ワークフローのデプロイ（自動）**

```bash
# n8n起動後に実行
N8N_API_KEY=<your_key> N8N_WORKFLOW_ID=<wf_id> python3 - <<'EOF'
import urllib.request, json, os

N8N_BASE_URL = "http://localhost:5678"
N8N_API_KEY  = os.environ["N8N_API_KEY"]
WF_ID        = os.environ["N8N_WORKFLOW_ID"]
headers      = {"X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json; charset=utf-8"}

with open("n8n/workflow.json") as f:
    payload = json.dumps(
        {k: v for k, v in json.load(f).items()
         if k in {"name","nodes","connections","settings","staticData","pinData"}},
        ensure_ascii=False
    ).encode()

req = urllib.request.Request(f"{N8N_BASE_URL}/api/v1/workflows/{WF_ID}",
                             data=payload, method="PUT", headers=headers)
with urllib.request.urlopen(req) as r:
    print(f"PUT {r.status}")

req = urllib.request.Request(f"{N8N_BASE_URL}/api/v1/workflows/{WF_ID}/activate",
                             method="POST", headers=headers)
with urllib.request.urlopen(req) as r:
    print(f"Activate {r.status}")
EOF
```

## ローカル開発

```bash
cd web
cp .env.local.example .env.local   # APIキー等を記入
npm install
npm run dev
```

開発サーバーは `http://localhost:3000` で起動します（ポート変更時は `PORT=3003 npm run dev`）。

Docker Composeでは、画面/APIを `http://localhost:3000`、CPU負荷の高い検索・
スクレイプ専用ワーカーを `http://localhost:3001` で分離します。n8nの検索ノードは
workerへ接続するため、大量処理中も通常画面をブロックしません。

候補ページの解析では、URLまたは検索タイトルが明白な404のものを取得前に除外します。
また、同期的な本文解析は候補1件ごとに `SCRAPE_ITEM_CPU_LIMIT_MS`（既定500ms）の
CPUタイムアウトを設け、超過した候補だけを `cpu_budget_exceeded` としてスキップします。
解析対象の本文長は `SCRAPE_ITEM_TEXT_LIMIT_CHARS`（既定250,000文字）で制限できます。

### 型チェック

```bash
cd web
npx tsc --noEmit
```

### ビルド確認

```bash
cd web
npm run build
```

## 使い方

1. ダッシュボードを開く（http://localhost:3000/dashboard）
2. 「新規プロジェクト」でプロジェクトを作成
3. 業種とエリアを選択して「実行開始」
4. 実行中は収集件数がリアルタイムで更新される
5. 完了後、実行履歴ページで収集件数と変換率を確認
6. プロジェクトページからCSVでダウンロード

### 変換率について

実行履歴の「収集件数」列に `N件中 X%` の形式で変換率が表示されます。

- N件 = Serper候補からポータル・地域外・重複を除いた公式HP候補数
- X% = 適合判定を通過し、実際に保存できた割合

## 注意事項

- 検索語はAND/ORで結合せず、それぞれ独立してSerper検索し、重複除去後に統合します。
- エリアは「渋谷区」「大阪府」のような地名を1件指定します。駅周辺・半径・距離検索への自動変換は行いません。
- Serperの一部ページが失敗した場合は再試行し、失敗数を実行履歴へ記録します。
- Hot Pepper Beauty対象業種では、市区町村別一覧を全ページ列挙し、店舗名・住所・電話番号を候補として公式HPを再検索します。ポータルページ自体は公式HPとして出力しません。
- 公式HPを特定できなかった店舗は `discovered_businesses` に保存します。初回導入時は `supabase/migrations/20260827_discovered_businesses.sql` をSupabaseへ適用してください。
- Serperの検索結果数と公式HPの実在数は同じではありません。検索源が返さないHPを件数合わせで補填することはしません。
- 大規模実行（全国・複数業種など）は相応の API 費用と実行時間が必要です。
- `.env` および `config/service-account.json` には機密情報が含まれるためリポジトリに含めないでください。

## ディレクトリ構成

```
auto-form/
├── web/                    # Next.js アプリ
│   ├── app/                # ページ・APIルート
│   ├── components/         # UIコンポーネント
│   └── lib/                # ビジネスロジック・型定義
├── n8n/                    # n8n ワークフロー定義
├── playwright-service/     # フォーム送信サービス
├── config/                 # 設定ファイル（service-account.json 等）
├── scripts/                # ユーティリティスクリプト
├── docker-compose.yml
└── .env.example
```
