import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

const HEADER_NAME = 'x-internal-api-key'

function matchesSecret(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function requireInternalAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { success: false, error: 'INTERNAL_API_SECRET is not configured' },
        { status: 503 },
      )
    }
    return null
  }

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const provided = req.headers.get(HEADER_NAME) ?? bearer
  if (!provided || !matchesSecret(provided, secret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export function getInternalJsonHeaders(): Record<string, string> {
  const secret = process.env.INTERNAL_API_SECRET
  return {
    'Content-Type': 'application/json',
    ...(secret ? { [HEADER_NAME]: secret } : {}),
  }
}
