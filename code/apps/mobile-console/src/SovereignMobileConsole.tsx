import {
  MemoryTokenStore,
  SovereignClient,
  SovereignRealtime,
  createActionNonce,
  type ProviderLaneState,
} from '@sovereign/platform-sdk'

const mobileDevice = {
  deviceId: 'mobile-console-dev',
  platform: 'ios' as const,
  appVersion: '0.1.0',
}

const tokenStore = new MemoryTokenStore()

export function createMobileControlClients(baseUrl: string, clientId: string) {
  const api = new SovereignClient({ baseUrl, tokenStore, device: mobileDevice })
  const realtime = new SovereignRealtime({ baseUrl, clientId, tokenStore, device: mobileDevice })
  return { api, realtime }
}

export function buildEmergencyPause(input: { clientId: string; actorId: string; provider?: ProviderLaneState['provider'] }) {
  return {
    clientId: input.clientId,
    actorId: input.actorId,
    provider: input.provider,
    action: input.provider ? 'pause_lane' as const : 'pause_all' as const,
    reason: 'Mobile emergency control approved by operator.',
    deviceId: mobileDevice.deviceId,
    nonce: createActionNonce(),
    timestampUtc: new Date().toISOString(),
  }
}

export function SovereignMobileConsole() {
  return null
}
