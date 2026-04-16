'use client'

import { ReactNode } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Header } from '@/components/header'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden md:ml-0">
        <Header />
        {/* Padding accounts for the fixed header (desktop) and the mobile top bar. */}
        <main className="flex-1 overflow-auto pt-16">
          <div className="mx-auto p-4 md:p-6 max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
