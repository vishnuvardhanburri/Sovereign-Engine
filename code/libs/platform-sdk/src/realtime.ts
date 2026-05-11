import type { RealtimeEvent } from './types'
import type { DeviceSession, TokenStore } from './auth'

export type RealtimeHandler = (event: RealtimeEvent) => void

export interface RealtimeOptions {
  baseUrl: string
  clientId: string
  tokenStore: TokenStore
  device: DeviceSession
  WebSocketImpl?: typeof WebSocket
}

export class SovereignRealtime {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private readonly handlers = new Set<RealtimeHandler>()

  constructor(private readonly options: RealtimeOptions) {}

  onEvent(handler: RealtimeHandler) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  async connect() {
    this.closed = false
    const tokens = await this.options.tokenStore.read()
    const wsUrl = new URL('/realtime', this.options.baseUrl)
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    wsUrl.searchParams.set('client_id', this.options.clientId)
    wsUrl.searchParams.set('device_id', this.options.device.deviceId)
    wsUrl.searchParams.set('platform', this.options.device.platform)

    const SocketCtor = this.options.WebSocketImpl ?? WebSocket
    const protocols = tokens?.accessToken
      ? ['sovereign-v1', `sovereign-token.${base64UrlEncode(tokens.accessToken)}`]
      : ['sovereign-v1']
    this.socket = new SocketCtor(wsUrl.toString(), protocols)
    this.socket.onmessage = (message) => this.emit(message.data)
    this.socket.onclose = () => this.scheduleReconnect()
    this.socket.onerror = () => this.scheduleReconnect()
  }

  close() {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.socket?.close()
    this.socket = null
  }

  private emit(raw: unknown) {
    if (typeof raw !== 'string') return
    try {
      const event = JSON.parse(raw) as RealtimeEvent
      for (const handler of this.handlers) handler(event)
    } catch {
      // Ignore malformed server frames; authoritative state is always fetched from REST.
    }
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, 1500)
  }
}

function base64UrlEncode(value: string) {
  const encoded = typeof btoa === 'function'
    ? btoa(value)
    : nodeLikeBase64(value)
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function nodeLikeBase64(value: string) {
  const runtime = globalThis as typeof globalThis & {
    Buffer?: { from(input: string): { toString(encoding: 'base64'): string } }
  }
  if (!runtime.Buffer) {
    throw new Error('No base64 encoder available for realtime token transport.')
  }
  return runtime.Buffer.from(value).toString('base64')
}
