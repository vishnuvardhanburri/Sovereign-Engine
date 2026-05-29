import { type NextRequest } from 'next/server'

function cleanOrigin(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (isUnroutableHostname(url.hostname)) return null
    return url.origin
  } catch {
    return null
  }
}

export function isUnroutableHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalized === '0.0.0.0' ||
    normalized === '::' ||
    normalized === '' ||
    normalized === 'localhost.localdomain'
  )
}

export function requestPublicOrigin(request: NextRequest): string {
  const configured =
    cleanOrigin(process.env.PUBLIC_APP_URL) ||
    cleanOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
    cleanOrigin(process.env.RENDER_EXTERNAL_URL)

  if (configured) return configured

  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host
  const hostname = host?.split(':')[0] || ''
  if (host && !isUnroutableHostname(hostname)) {
    const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'https'
    return `${proto}://${host}`
  }

  if (!isUnroutableHostname(request.nextUrl.hostname)) {
    return request.nextUrl.origin
  }

  return `http://127.0.0.1:${process.env.PORT || '10000'}`
}
