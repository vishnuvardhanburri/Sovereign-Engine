'use client'

import { ReactNode } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Header } from '@/components/header'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        {/* Padding accounts for the fixed header (desktop) and the mobile top bar. */}
        <main className="flex-1 overflow-auto pt-16 md:pt-0">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-5 md:px-6">
            <div className="mb-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-900 dark:text-cyan-100">
              <span className="font-semibold">Evaluation mode:</span> sample data and stress proofs are safe by default. Real sending unlocks only after operator-owned domains, SMTP/ESP credentials, DNS, suppression policy, and production secrets are connected.
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
