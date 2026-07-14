export interface RunErrorExplanation {
  code: string
  title: string
  description: string
  technicalDetails?: string
  failedNode?: string
}

function redactSecrets(value: string): string {
  return value
    .replace(/(bearer\s+)[a-z0-9._~-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
}

function partValue(raw: string, key: string): string | undefined {
  const part = raw.split(' | ').find((item) => item.startsWith(`${key}=`))
  return part?.slice(key.length + 1).trim() || undefined
}

function extractCode(raw: string): string {
  const explicit = partValue(raw, 'code')
    ?? raw.match(/["']?code["']?\s*[:=]\s*["']?([A-Z0-9_-]+)/i)?.[1]
  if (explicit) return explicit.toUpperCase()

  const http = raw.match(/(?:webhook failed|execution|http(?: error)?)[^0-9]{0,10}(\d{3})/i)?.[1]
  if (http) return `HTTP_${http}`

  const postgres = raw.match(/\b(23(?:505|503)|42P01|PGRST\d+)\b/i)?.[1]
  if (postgres) return postgres.toUpperCase()

  return 'UNCLASSIFIED_EXECUTION_ERROR'
}

export function explainRunError(error?: string): RunErrorExplanation {
  const raw = error?.trim()
  if (!raw) {
    return {
      code: 'ERROR_DETAILS_NOT_RECORDED',
      title: 'エラーの詳細が記録されていません',
      description: 'この実行では原因情報が保存されていないため、詳細を特定できません。再実行後に同じ問題が起きた場合は、次回から原因とエラーコードが表示されます。',
    }
  }

  const safeRaw = redactSecrets(raw)
  const normalized = safeRaw.toLowerCase()
  const failedNode = partValue(safeRaw, 'node')
  const message = partValue(safeRaw, 'message')
  const code = extractCode(safeRaw)

  if (normalized.includes('canceled_by_user')) {
    return {
      code: 'CANCELED_BY_USER',
      title: 'ユーザー操作によりキャンセルされました',
      description: '実行履歴または実行画面からキャンセル操作が行われたため、処理を終了しました。',
      technicalDetails: safeRaw,
    }
  }

  if (normalized.includes('server_restart')) {
    return {
      code: 'SERVER_RESTART',
      title: 'サーバー再起動により処理が中断されました',
      description: '実行中にアプリケーションサーバーが再起動し、処理を継続できませんでした。接続先が安定していることを確認して再実行してください。',
      technicalDetails: safeRaw,
    }
  }

  if (normalized.includes('auto_expired_stale_running')) {
    return {
      code: 'RUN_TIMEOUT',
      title: '実行が制限時間を超えました',
      description: '実行開始後、完了通知が一定時間届かなかったため自動終了しました。n8n の実行状況とコールバック先を確認してください。',
      technicalDetails: safeRaw,
    }
  }

  if (normalized.includes('auto_expired_stale_pending')) {
    return {
      code: 'QUEUE_WAIT_TIMEOUT',
      title: 'キューの待機時間を超えました',
      description: '実行待ちのまま長時間開始されなかったため自動終了しました。キューの同時実行数と n8n の稼働状況を確認してください。',
      technicalDetails: safeRaw,
    }
  }

  if (normalized.includes('batch_all_children_failed')) {
    return {
      code: 'BATCH_ALL_CHILDREN_FAILED',
      title: 'すべての対象エリアで実行に失敗しました',
      description: '一括実行に含まれる子処理がすべて失敗しました。接続設定や検索 API の設定を確認して再実行してください。',
      technicalDetails: safeRaw,
    }
  }

  if (normalized.includes('timeout') || normalized.includes('aborted') || normalized.includes('aborterror')) {
    return {
      code: code === 'UNCLASSIFIED_EXECUTION_ERROR' ? 'REQUEST_TIMEOUT' : code,
      title: '外部サービスから時間内に応答がありませんでした',
      description: 'n8n または外部 API への接続がタイムアウトしました。接続先の稼働状況を確認して再実行してください。',
      technicalDetails: safeRaw,
      failedNode,
    }
  }

  if (normalized.includes('429') || normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return {
      code: code === 'UNCLASSIFIED_EXECUTION_ERROR' ? 'RATE_LIMITED' : code,
      title: '外部 API の利用上限に達しました',
      description: '短時間のリクエスト数が上限を超えました。しばらく待つか、同時実行数を減らして再実行してください。',
      technicalDetails: safeRaw,
      failedNode,
    }
  }

  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('unauthorized') || normalized.includes('forbidden')) {
    return {
      code: code === 'UNCLASSIFIED_EXECUTION_ERROR' ? 'AUTHENTICATION_FAILED' : code,
      title: '外部サービスの認証に失敗しました',
      description: 'API キーが無効、期限切れ、または必要な権限が不足しています。環境変数と接続先サービスの権限を確認してください。',
      technicalDetails: safeRaw,
      failedNode,
    }
  }

  if (normalized.includes('webhook failed')) {
    const status = safeRaw.match(/webhook failed:\s*(\d{3})/i)?.[1]
    const description = status === '404'
      ? 'n8n の Webhook が見つかりません。ワークフローが有効か、Webhook パスが正しいか確認してください。'
      : status && Number(status) >= 500
        ? 'n8n 側で一時的なサーバーエラーが発生しました。n8n の実行ログを確認して再実行してください。'
        : 'n8n の Webhook を開始できませんでした。接続先 URL とワークフローの状態を確認してください。'
    return {
      code: status ? `HTTP_${status}` : 'N8N_WEBHOOK_FAILED',
      title: 'n8n ワークフローを開始できませんでした',
      description,
      technicalDetails: safeRaw,
    }
  }

  if (normalized.includes('econnrefused') || normalized.includes('enotfound') || normalized.includes('fetch failed')) {
    return {
      code: code === 'UNCLASSIFIED_EXECUTION_ERROR' ? 'SERVICE_UNREACHABLE' : code,
      title: '接続先サービスへ到達できませんでした',
      description: 'n8n または外部 API の URL に接続できません。URL、DNS、ネットワーク、サービスの起動状態を確認してください。',
      technicalDetails: safeRaw,
      failedNode,
    }
  }

  if (normalized.includes('supabase_url') || normalized.includes('supabase_service_key')) {
    return {
      code: 'SUPABASE_CONFIG_MISSING',
      title: 'データベースの接続設定が不足しています',
      description: 'Supabase の URL またはサービスキーが設定されていません。サーバーの環境変数を確認してください。',
      technicalDetails: safeRaw,
    }
  }

  if (normalized.includes('n8n_execution_failed')) {
    return {
      code: code === 'UNCLASSIFIED_EXECUTION_ERROR' ? 'N8N_EXECUTION_FAILED' : code,
      title: failedNode ? `n8n の「${failedNode}」で処理に失敗しました` : 'n8n ワークフローの実行に失敗しました',
      description: message
        ? `n8n から「${message}」というエラーが返されました。設定値や入力内容を確認してください。`
        : 'n8n から失敗状態が返されました。詳細メッセージがないため、下記のエラーコードと実行 ID を確認してください。',
      technicalDetails: safeRaw,
      failedNode,
    }
  }

  return {
    code,
    title: '実行中に処理エラーが発生しました',
    description: '保存された情報から原因を自動判定できませんでした。下記のエラーコードと技術情報を確認してください。',
    technicalDetails: safeRaw,
    failedNode,
  }
}
