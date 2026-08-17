# リスト収集AI - セットアップガイド

## 必要なAPI・サービス

| サービス | 用途 | 費用 |
|---------|------|------|
| Serper API | ローカル事業者・公式HP検索 | 契約プランによる |
| OpenAI API (gpt-4o-mini) | フォーム種別判定 | ~$0.15/1Mトークン |
| Google Sheets API | リスト書き込み | 無料 |

---

## Step 1: Google Cloud の設定

### 1-1. プロジェクト作成
1. [Google Cloud Console](https://console.cloud.google.com) を開く
2. 新しいプロジェクトを作成（例: `list-collector`）

### 1-2. APIの有効化
以下のAPIを有効化してください：
- Google Sheets API

### 1-3. サービスアカウントの作成（Sheets API用）
1. 「認証情報」→「認証情報を作成」→「サービスアカウント」
2. サービスアカウントを作成
3. 「キー」タブ→「キーを追加」→「JSONキーを作成」
4. ダウンロードしたJSONを `config/service-account.json` として保存

---

## Step 2: Google スプレッドシートの設定

1. 新しいスプレッドシートを作成
2. スプレッドシートURLから ID をコピー
   - URL: `https://docs.google.com/spreadsheets/d/{スプレッドシートID}/edit`
3. 「共有」でサービスアカウントのメールアドレスを追加（編集者権限）
4. シート名を「企業リスト」に設定（またはENVで変更）

---

## Step 3: 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集：

```env
SERPER_API_KEY=your_serper_api_key
OPENAI_API_KEY=your_openai_key
GOOGLE_SHEETS_ID=your_spreadsheet_id
```

---

## Step 4: 検索パラメータの設定

`config/search-params.json` を編集：

```json
{
  "runs": [
    {
      "id": "run-001",
      "enabled": true,
      "label": "東京・美容室",
      "searchTargets": [
        {
          "industry": "美容室",
          "area": "東京都",
          "keywords": ["美容室", "ヘアサロン"],
          "maxResults": 0
        }
      ]
    }
  ]
}
```

---

## Step 5: 実行

### Node.js スクリプトで実行
```bash
npm install
npm start
```

### n8nワークフローで実行

1. n8nを起動（VPSまたはローカル）
2. 「ワークフロー」→「インポート」→ `n8n/workflow.json` を選択
3. 以下の認証情報を設定：
   - **Google Sheets API** - OAuth2またはサービスアカウント
   - **OpenAI API** - APIキー
4. n8nの「Variables」に以下を設定：
   - `SERPER_API_KEY`
   - `GOOGLE_SHEETS_ID`
5. 「実行」ボタンで手動実行、またはスケジュールで自動実行

---

## n8n セルフホスト (VPS)

```bash
# Docker Composeで起動
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n

# ブラウザで http://localhost:5678 を開く
```

---

## スプレッドシートの列構成

| 列 | 項目 | 説明 |
|----|------|------|
| A | 会社名 | 企業名 |
| B | HP URL | 企業WebサイトURL |
| C | フォームURL | お問い合わせフォームURL |
| D | 電話番号 | 代表電話番号 |
| E | メールアドレス | 問い合わせ用メール |
| F | 住所 | 所在地 |
| G | 業種 | 検索条件の業種 |
| H | エリア | 検索条件のエリア |
| I | フォーム種別 | inquiry / booking / unknown |
| J | 収集日時 | 自動記入 |
| K | ステータス | 未送信 / 送信済み / 除外 |
| L | 備考 | メモ欄 |

---

## トラブルシューティング

**Serper APIエラー (429)**
→ APIプランの上限を確認してください。検索は一時エラーを最大3回再試行し、失敗数を実行履歴へ記録します。

**スプレッドシートへの書き込みエラー**
→ サービスアカウントにスプレッドシートの「編集者」権限があるか確認

**フォームが検出されない**
→ `config/search-params.json` の `contactPageKeywords` にキーワードを追加

**GPTエラー / APIキー未設定**
→ ルールベース判定にフォールバックします（精度は若干低下）
