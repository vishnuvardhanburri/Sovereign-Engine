import {
  MemoryTokenStore,
  SovereignClient,
  SovereignRealtime,
  createActionNonce,
  type ProviderLaneState,
  type RealtimeEvent,
} from '@sovereign/platform-sdk'

const defaultLanes: ProviderLaneState[] = [
  {
    provider: 'gmail',
    status: 'healthy',
    maxPerHour: 1200,
    deferralRate1h: 0.012,
    blockRate1h: 0.001,
    seedPlacementInboxRate: 0.94,
    updatedAt: new Date().toISOString(),
  },
  {
    provider: 'outlook',
    status: 'throttled',
    maxPerHour: 650,
    deferralRate1h: 0.034,
    blockRate1h: 0.003,
    seedPlacementInboxRate: 0.9,
    updatedAt: new Date().toISOString(),
    reason: 'Safe-ramp reduced pressure after deferral rise.',
  },
  {
    provider: 'yahoo',
    status: 'healthy',
    maxPerHour: 900,
    deferralRate1h: 0.009,
    blockRate1h: 0.001,
    seedPlacementInboxRate: 0.92,
    updatedAt: new Date().toISOString(),
  },
  {
    provider: 'icloud',
    status: 'paused',
    maxPerHour: 0,
    deferralRate1h: 0.02,
    blockRate1h: 0.061,
    seedPlacementInboxRate: 0.78,
    updatedAt: new Date().toISOString(),
    reason: 'Manual pause awaiting operator approval.',
  },
]

const device = {
  deviceId: 'desktop-console-dev',
  platform: 'macos' as const,
  appVersion: '0.1.0',
}

const tokenStore = new MemoryTokenStore()

export function createDesktopControlClients(baseUrl: string, clientId: string) {
  const api = new SovereignClient({ baseUrl, tokenStore, device })
  const realtime = new SovereignRealtime({ baseUrl, clientId, tokenStore, device })
  return { api, realtime }
}

export function buildDesktopPauseAction(input: {
  clientId: string
  provider?: ProviderLaneState['provider']
  actorId: string
  reason: string
}) {
  return {
    clientId: input.clientId,
    provider: input.provider,
    action: input.provider ? 'pause_lane' as const : 'pause_all' as const,
    reason: input.reason,
    actorId: input.actorId,
    deviceId: device.deviceId,
    nonce: createActionNonce(),
    timestampUtc: new Date().toISOString(),
  }
}

export function applyRealtimeLaneEvent(lanes: ProviderLaneState[], event: RealtimeEvent) {
  if (event.type !== 'lane.state.changed') return lanes
  return lanes.map((lane) => lane.provider === event.payload.provider ? event.payload : lane)
}

export default function SovereignDesktopConsole() {
  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <section className="mx-auto max-w-6xl">
        <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Sovereign Engine</p>
        <h1 className="mt-3 text-4xl font-semibold">Desktop Operations Console</h1>
        <p className="mt-4 max-w-3xl text-slate-300">
          Tauri shell for live reputation monitoring, provider lane control, queue pressure, worker heartbeats,
          deployment diagnostics, and investor/demo recording mode. All operational actions reconcile through
          the central API gateway.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {defaultLanes.map((lane) => (
            <article key={lane.provider} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold capitalize">{lane.provider}</h2>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase">{lane.status}</span>
              </div>
              <p className="mt-4 text-3xl font-bold">{lane.maxPerHour.toLocaleString()}</p>
              <p className="text-sm text-slate-400">max/hour</p>
              <p className="mt-4 text-sm text-slate-300">
                Deferrals {(lane.deferralRate1h * 100).toFixed(1)}% · Blocks {(lane.blockRate1h * 100).toFixed(1)}%
              </p>
              {lane.reason ? <p className="mt-3 text-xs text-amber-200">{lane.reason}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
