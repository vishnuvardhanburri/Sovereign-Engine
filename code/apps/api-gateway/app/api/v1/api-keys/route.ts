import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const name = String(body.name || 'Investor Demo Key')
  const secret = `se_${crypto.randomBytes(18).toString('hex')}`
  return NextResponse.json({
    id: crypto.randomUUID(),
    name,
    key_prefix: secret.slice(0, 10),
    secret,
    scopes: body.scopes || ['metrics:read', 'reputation:read', 'queue:read'],
    created_at: new Date().toISOString(),
    note: 'Demo API-key issuer. Persist keys in database/secret manager for production SaaS.',
  })
}

export async function GET() {
  return NextResponse.json({
    api_keys: [
      {
        id: 'demo-key',
        name: 'Investor Demo Key',
        key_prefix: 'se_demo',
        scopes: ['metrics:read', 'reputation:read', 'queue:read'],
        status: 'active',
      },
    ],
  })
}
