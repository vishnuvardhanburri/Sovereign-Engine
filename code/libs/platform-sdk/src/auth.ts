export interface DeviceSession {
  deviceId: string
  platform: 'web' | 'macos' | 'windows' | 'linux' | 'android' | 'ios'
  appVersion: string
  sessionId?: string
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
}

export interface TokenStore {
  read(): Promise<TokenSet | null>
  write(tokens: TokenSet): Promise<void>
  clear(): Promise<void>
}

export class MemoryTokenStore implements TokenStore {
  private current: TokenSet | null = null

  async read() {
    return this.current
  }

  async write(tokens: TokenSet) {
    this.current = tokens
  }

  async clear() {
    this.current = null
  }
}

export function createActionNonce() {
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createActionSigningPayload(input: {
  actorId: string
  action: string
  clientId: string
  deviceId: string
  nonce: string
  timestampUtc: string
  provider?: string
  domain?: string
}) {
  return [
    input.actorId,
    input.action,
    input.clientId,
    input.deviceId,
    input.nonce,
    input.timestampUtc,
    input.provider ?? '',
    input.domain ?? '',
  ].join('\n')
}
