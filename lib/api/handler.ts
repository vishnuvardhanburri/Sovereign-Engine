import { NextResponse } from 'next/server'

export async function withApiError<T>(fn: () => Promise<T>) {
  try {
    const data = await fn()
    return NextResponse.json(data)
  } catch (error) {
    console.error('[API] handler error', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

