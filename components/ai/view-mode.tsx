'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type ViewMode = 'operator' | 'client'

type DemoState = { enabled: boolean; updatedAt: string; beforeAfter?: any; counters?: any }

type Ctx = {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  demoMode: boolean
  setDemoMode: (enabled: boolean) => Promise<void>
  demoState: DemoState | null
  refreshDemoState: () => Promise<void>
}

const C = createContext<Ctx | null>(null)

const VIEW_KEY = 'xavira:view_mode'

export function useViewMode() {
  const ctx = useContext(C)
  if (!ctx) throw new Error('useViewMode must be used within ViewModeProvider')
  return ctx
}

export function ViewModeProvider(props: { children: React.ReactNode }) {
  const [viewMode, setViewModeState] = useState<ViewMode>('operator')
  const [demoState, setDemoState] = useState<DemoState | null>(null)
  const demoMode = Boolean(demoState?.enabled)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_KEY)
      if (stored === 'client' || stored === 'operator') setViewModeState(stored)
    } catch {
      // ignore
    }
  }, [])

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    try {
      window.localStorage.setItem(VIEW_KEY, mode)
    } catch {
      // ignore
    }
  }, [])

  const refreshDemoState = useCallback(async () => {
    const res = await fetch('/api/demo/state')
    const json = await res.json().catch(() => null)
    if (res.ok && json?.ok) {
      setDemoState(json.data)
      return
    }
    setDemoState({ enabled: false, updatedAt: new Date().toISOString() })
  }, [])

  useEffect(() => {
    refreshDemoState().catch(() => {})
    const id = window.setInterval(() => refreshDemoState().catch(() => {}), 10_000)
    return () => window.clearInterval(id)
  }, [refreshDemoState])

  const setDemoMode = useCallback(async (enabled: boolean) => {
    const res = await fetch('/api/demo/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to toggle demo mode')
    await refreshDemoState()
  }, [refreshDemoState])

  const value = useMemo<Ctx>(
    () => ({
      viewMode,
      setViewMode,
      demoMode,
      setDemoMode,
      demoState,
      refreshDemoState,
    }),
    [viewMode, setViewMode, demoMode, setDemoMode, demoState, refreshDemoState],
  )

  return <C.Provider value={value}>{props.children}</C.Provider>
}
