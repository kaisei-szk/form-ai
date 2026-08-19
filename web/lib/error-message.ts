type ErrorLike = {
  message?: unknown
  details?: unknown
  hint?: unknown
  code?: unknown
}

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === 'object' && value !== null
}

/**
 * Error objects returned by Supabase are plain objects, so String(error)
 * becomes "[object Object]". Keep API errors readable without leaking the
 * full response object to the UI.
 */
export function getErrorMessage(error: unknown, fallback = '予期しないエラーが発生しました'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error

  if (isErrorLike(error)) {
    const parts = [error.message, error.details, error.hint]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (parts.length > 0) return [...new Set(parts)].join(' — ')
  }

  return fallback
}

export function isMissingDatabaseSchemaError(error: unknown): boolean {
  const message = getErrorMessage(error, '')
  const code = isErrorLike(error) && typeof error.code === 'string' ? error.code : ''
  return code === 'PGRST205'
    || message.includes('Could not find the table')
    || message.includes('schema cache')
}
