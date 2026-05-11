'use client'

import { create } from 'zustand'

export type EnterpriseAlertSeverity = 'info' | 'warning' | 'critical'
export type EnterpriseAlertState = 'open' | 'acknowledged' | 'resolved'

export interface EnterpriseAlert {
  id: string
  title: string
  detail: string
  severity: EnterpriseAlertSeverity
  source: 'health' | 'reputation' | 'queue' | 'worker' | 'security' | 'deployment'
  state: EnterpriseAlertState
  createdAt: string
  updatedAt: string
}

interface EnterpriseAlertStore {
  alerts: EnterpriseAlert[]
  upsertAlert: (alert: Omit<EnterpriseAlert, 'state' | 'createdAt' | 'updatedAt'> & { updatedAt?: string }) => void
  acknowledge: (id: string) => void
  resolve: (id: string) => void
  acknowledgeAll: () => void
}

export const useEnterpriseAlerts = create<EnterpriseAlertStore>((set) => ({
  alerts: [],
  upsertAlert: (incoming) =>
    set((state) => {
      const now = incoming.updatedAt ?? new Date().toISOString()
      const existing = state.alerts.find((alert) => alert.id === incoming.id)
      const nextAlert: EnterpriseAlert = existing
        ? { ...existing, ...incoming, state: existing.state === 'resolved' ? 'open' : existing.state, updatedAt: now }
        : { ...incoming, state: 'open', createdAt: now, updatedAt: now }
      const alerts = existing
        ? state.alerts.map((alert) => (alert.id === incoming.id ? nextAlert : alert))
        : [nextAlert, ...state.alerts]
      return { alerts: alerts.slice(0, 80) }
    }),
  acknowledge: (id) =>
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === id ? { ...alert, state: 'acknowledged', updatedAt: new Date().toISOString() } : alert
      ),
    })),
  resolve: (id) =>
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === id ? { ...alert, state: 'resolved', updatedAt: new Date().toISOString() } : alert
      ),
    })),
  acknowledgeAll: () =>
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.state === 'open' ? { ...alert, state: 'acknowledged', updatedAt: new Date().toISOString() } : alert
      ),
    })),
}))

export function severityRank(severity: EnterpriseAlertSeverity) {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}
