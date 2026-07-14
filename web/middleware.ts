import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next()

  const internalSecret = process.env.INTERNAL_API_SECRET
  const internalKey = req.headers.get('x-internal-api-key')
  if (internalSecret && internalKey === internalSecret) return NextResponse.next()

  const expectedUser = process.env.APP_BASIC_AUTH_USER
  const expectedPassword = process.env.APP_BASIC_AUTH_PASSWORD
  if (!expectedUser || !expectedPassword) {
    return NextResponse.json(
      { success: false, error: 'Application authentication is not configured' },
      { status: 503 },
    )
  }

  const authorization = req.headers.get('authorization') ?? ''
  if (authorization.startsWith('Basic ')) {
    try {
      const [user, ...passwordParts] = atob(authorization.slice(6)).split(':')
      if (user === expectedUser && passwordParts.join(':') === expectedPassword) return NextResponse.next()
    } catch {
      // Invalid base64 is handled as an authentication failure.
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="form-ai", charset="UTF-8"' },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
