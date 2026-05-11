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

const mobileIncidentCards = [
  { title: 'Queue spike', severity: 'warning', detail: '1,240 jobs waiting. Approval required if pressure persists.' },
  { title: 'Worker recovered', severity: 'info', detail: 'eu-west sender node rejoined and reconciled state.' },
  { title: 'Provider lane paused', severity: 'critical', detail: 'iCloud lane is paused until operator review.' },
]

const mobileQuickActions = [
  'Emergency pause with biometric confirmation',
  'Acknowledge incident',
  'Approve safe resume',
  'Escalate to desktop operator',
]

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

export function buildMobileConsoleState(input: {
  lanes: ProviderLaneState[]
  unreadAlerts: number
  connectionState: 'online' | 'reconnecting' | 'offline'
}) {
  const criticalLane = input.lanes.find((lane) => lane.status === 'paused')
  return {
    connectionState: input.connectionState,
    requiresBiometricConfirmation: Boolean(criticalLane || input.unreadAlerts > 0),
    headline: criticalLane ? `${criticalLane.provider} requires review` : 'All provider lanes are operational',
    incidentCards: mobileIncidentCards,
    quickActions: mobileQuickActions,
  }
}

export function SovereignMobileConsole() {
  const state = buildMobileConsoleState({
    lanes: [
      { provider: 'gmail', status: 'healthy', maxPerHour: 1200, deferralRate1h: 0.01, blockRate1h: 0.001, seedPlacementInboxRate: 0.94, updatedAt: new Date().toISOString() },
      { provider: 'outlook', status: 'throttled', maxPerHour: 650, deferralRate1h: 0.034, blockRate1h: 0.003, seedPlacementInboxRate: 0.9, updatedAt: new Date().toISOString() },
      { provider: 'icloud', status: 'paused', maxPerHour: 0, deferralRate1h: 0.02, blockRate1h: 0.061, seedPlacementInboxRate: 0.78, updatedAt: new Date().toISOString() },
    ],
    unreadAlerts: 3,
    connectionState: 'online',
  })

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-slate-100">
      <section className="mx-auto max-w-md space-y-4">
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-5">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Mobile Command</p>
          <h1 className="mt-3 text-3xl font-semibold">{state.headline}</h1>
          <p className="mt-2 text-sm text-slate-400">
            Push-ready incident cards, emergency controls, offline recovery, and biometric confirmation for high-risk actions.
          </p>
          <div className="mt-4 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
            Connection {state.connectionState} - encrypted local persistence ready
          </div>
        </div>

        <div className="space-y-3">
          {state.incidentCards.map((card) => (
            <article key={card.title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{card.title}</h2>
                <span className="rounded-full border border-white/10 bg-black/25 px-2 py-1 text-[11px] uppercase">{card.severity}</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{card.detail}</p>
            </article>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {state.quickActions.map((action) => (
            <button key={action} className="rounded-2xl border border-white/10 bg-slate-900 p-3 text-left text-xs text-slate-200">
              {action}
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}
