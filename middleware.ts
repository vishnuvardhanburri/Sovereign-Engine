import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/me', '/api/auth/logout', '/api/webhooks/resend'])
const SESSION_COOKIE = 'xo_session'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/_next') || pathname.startsWith('/public')) {
    return NextResponse.next()
  }

  // Protect dashboard pages (and keep APIs open for workers/integrations).
  const protect =
    pathname === '/' ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/campaigns') ||
    pathname.startsWith('/contacts') ||
    pathname.startsWith('/domains') ||
    pathname.startsWith('/sequences') ||
    pathname.startsWith('/inbox') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/next-level') ||
    pathname.startsWith('/ai-assistant')

  if (!protect) {
    return NextResponse.next()
  }

  // Middleware runs on the Edge runtime; only check cookie presence here.
  // Token verification is handled by API routes / server code.
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? ''
  if (!token) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
