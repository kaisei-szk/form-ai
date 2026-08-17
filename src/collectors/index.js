import logger from '../utils/logger.js'
import { searchBySerper } from './serper-search.js'

/**
 * 企業収集の統合エントリーポイント
 *
 * Serper.dev のみを利用する。
 */
export async function collectCompanies(params) {
  if (!process.env.SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY が必要です')
  }

  try {
    const items = await searchBySerper(params)
    logger.info(`収集合計: ${items.length}件 (Serper)`)
    return items
  } catch (error) {
    logger.error('Serper検索失敗', { error: error?.message })
    throw error
  }
}
