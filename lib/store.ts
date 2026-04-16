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
  login: (email: string, password: string) => void
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
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  isLoading: false,
  login: (email: string, password: string) => {
    set({ isLoading: true })
    // Simulate login delay
    setTimeout(() => {
      const mockUser = {
        id: '1',
        email,
        name: email.split('@')[0],
      }
      const token = `token_${Date.now()}`
      localStorage.setItem('token', token)
      set({ user: mockUser, token, isLoading: false })
    }, 500)
  },
  logout: () => {
    localStorage.removeItem('token')
    set({ user: null, token: null })
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
