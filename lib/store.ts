import { create } from 'zustand'

export interface User {
  id: string
  email: string
  name: string
}

export interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  bootstrap: () => Promise<void>
  logout: () => void
  setUser: (user: User | null) => void
}

export interface UIState {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  timezone: string
  setTimezone: (tz: string) => void
  autoUnsubscribeBounce: boolean
  setAutoUnsubscribeBounce: (enabled: boolean) => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: false,
  login: async (email: string, password: string) => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        throw new Error('login failed')
      }
      const data = (await res.json()) as { user?: { id: number; email: string } }
      const user = data.user
        ? { id: String(data.user.id), email: data.user.email, name: data.user.email.split('@')[0] }
        : { id: '0', email, name: email.split('@')[0] }
      set({ user, token: 'cookie', isLoading: false })
    } catch {
      set({ user: null, token: null, isLoading: false })
      throw new Error('login failed')
    }
  },
  bootstrap: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/auth/me', { method: 'GET' })
      const data = (await res.json()) as { user: { id: number; email: string } | null }
      if (data.user) {
        set({
          user: { id: String(data.user.id), email: data.user.email, name: data.user.email.split('@')[0] },
          token: 'cookie',
          isLoading: false,
        })
      } else {
        set({ user: null, token: null, isLoading: false })
      }
    } catch {
      set({ user: null, token: null, isLoading: false })
    }
  },
  logout: () => {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    set({ user: null, token: null, isLoading: false })
  },
  setUser: (user) => set({ user }),
}))

export const useUI = create<UIState>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  timezone: 'America/New_York',
  setTimezone: (tz) => set({ timezone: tz }),
  autoUnsubscribeBounce: true,
  setAutoUnsubscribeBounce: (enabled) => set({ autoUnsubscribeBounce: enabled }),
}))
