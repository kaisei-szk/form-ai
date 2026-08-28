import * as vm from 'node:vm'

const DEFAULT_MAX_TEXT_CHARS = 250_000

// Keep the expression bounded even before the VM watchdog intervenes. The old
// pattern used several adjacent, unbounded whitespace alternatives and could
// backtrack catastrophically on large error pages.
const OBFUSCATED_EMAIL_SCAN = String.raw`
(() => {
  const match = input.match(/([a-zA-Z0-9._%+\-]{2,64})[ \t\u3000]{0,20}(?:\[at\]|\(at\)|【at】|＠|[ \t]{1,8}at[ \t]{1,8}|@)[ \t\u3000]{0,20}([a-zA-Z0-9.\-]{2,190}\.[a-zA-Z]{2,24})/i)
  return match ? { local: match[1], domain: match[2] } : null
})()
`

export class ItemCpuLimitError extends Error {
  readonly code = 'cpu_budget_exceeded'

  constructor(limitMs: number) {
    super(`Item analysis exceeded the ${limitMs}ms CPU limit`)
    this.name = 'ItemCpuLimitError'
  }
}

/**
 * Run the only potentially expensive free-text pattern behind V8's watchdog.
 * vm.runInNewContext interrupts synchronous regexp execution when it exceeds
 * the supplied CPU time, so one malformed page cannot block the whole batch.
 */
export function scanObfuscatedEmail(
  text: string,
  cpuLimitMs: number,
  maxTextChars = DEFAULT_MAX_TEXT_CHARS
): string | null {
  const limitMs = Math.max(1, Math.floor(cpuLimitMs))
  const boundedInput = text.slice(0, Math.max(1, maxTextChars))

  try {
    const match = vm.runInNewContext(
      OBFUSCATED_EMAIL_SCAN,
      { input: boundedInput },
      { timeout: limitMs }
    ) as { local?: unknown; domain?: unknown } | null
    if (!match || typeof match.local !== 'string' || typeof match.domain !== 'string') return null
    return `${match.local}@${match.domain}`
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    const message = error instanceof Error ? error.message : String(error)
    if (code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || /Script execution timed out/i.test(message)) {
      throw new ItemCpuLimitError(limitMs)
    }
    throw error
  }
}
