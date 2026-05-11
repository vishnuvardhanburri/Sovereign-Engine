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

const quickActions = [
  { label: 'Pause all lanes', shortcut: 'Cmd+Shift+P' },
  { label: 'Resume healthy lanes', shortcut: 'Cmd+Shift+R' },
  { label: 'Open health oracle', shortcut: 'Cmd+K H' },
  { label: 'Start recording mode', shortcut: 'Cmd+K D' },
]

const operationalEvents = [
  'Websocket connected with authoritative reconciliation.',
  'Desktop notifications armed for critical incidents.',
  'Offline cache ready for last known reputation state.',
  'Window state persistence active for operator workspaces.',
]

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_28%),linear-gradient(135deg,#020617,#0f172a)] p-8 text-slate-100">
      <section className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Sovereign Engine</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Desktop Operations Console</h1>
            <p className="mt-4 max-w-3xl text-slate-300">
              Native Tauri control shell for live reputation monitoring, provider lane controls, queue pressure,
              worker heartbeats, deployment diagnostics, and investor/demo recording mode. Clients remain consoles;
              the API gateway stays authoritative.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            <span className="mr-2 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300" />
            Realtime connected
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/25">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Provider lane cockpit</h2>
                <p className="text-sm text-slate-400">Keyboard-operable, audit-backed, reconciled with central state.</p>
              </div>
              <div className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-slate-300">
                Latency 21ms · Sync healthy
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-4">
              {defaultLanes.map((lane) => (
                <article key={lane.provider} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold capitalize">{lane.provider}</h3>
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
          </div>

          <aside className="rounded-3xl border border-white/10 bg-black/25 p-5">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">Command palette</p>
              <p className="mt-2 text-sm text-slate-200">Press Cmd+K for operational actions, diagnostics, and recovery workflows.</p>
            </div>
            <div className="mt-4 space-y-3">
              {quickActions.map((action) => (
                <div key={action.label} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <span className="text-sm">{action.label}</span>
                  <kbd className="rounded-md border border-white/10 bg-slate-950 px-2 py-1 text-[11px] text-slate-300">{action.shortcut}</kbd>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          {operationalEvents.map((event) => (
            <div key={event} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-300">
              {event}
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
