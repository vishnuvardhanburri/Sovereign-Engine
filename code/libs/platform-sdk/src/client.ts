import type {
  HealthStats,
  OperationalActionRequest,
  OperationalActionResult,
  ReputationSnapshot,
} from './types'
import type { DeviceSession, TokenStore } from './auth'

export interface SovereignClientOptions {
  baseUrl: string
  tokenStore: TokenStore
  device: DeviceSession
  fetchImpl?: typeof fetch
}

export class SovereignClient {
  private readonly baseUrl: string
  private readonly tokenStore: TokenStore
  private readonly device: DeviceSession
  private readonly fetchImpl: typeof fetch

  constructor(options: SovereignClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.tokenStore = options.tokenStore
    this.device = options.device
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async getReputationSnapshot(params: { clientId: string; domain?: string }): Promise<ReputationSnapshot> {
    const query = new URLSearchParams({ client_id: params.clientId })
    if (params.domain) query.set('domain', params.domain)
    return this.request(`/api/reputation/monitor?${query.toString()}`)
  }

  async getHealthStats(clientId: string): Promise<HealthStats> {
    const query = new URLSearchParams({ client_id: clientId })
    return this.request(`/api/health/stats?${query.toString()}`)
  }

  async submitOperationalAction(action: OperationalActionRequest): Promise<OperationalActionResult> {
    return this.request('/api/reputation/override', {
      method: 'POST',
      body: JSON.stringify(action),
      headers: {
        'content-type': 'application/json',
        'x-sovereign-device-id': this.device.deviceId,
        'x-sovereign-platform': this.device.platform,
        ...(action.signature ? { 'x-sovereign-action-signature': action.signature } : {}),
      },
    })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const tokens = await this.tokenStore.read()
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(tokens?.accessToken ? { authorization: `Bearer ${tokens.accessToken}` } : {}),
        'x-sovereign-device-id': this.device.deviceId,
        'x-sovereign-platform': this.device.platform,
        ...init.headers,
      },
    })

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText)
      throw new Error(`Sovereign API ${response.status}: ${message}`)
    }

    return response.json() as Promise<T>
  }
}
