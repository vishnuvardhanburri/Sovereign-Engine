'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  Menu,
  X,
  LayoutDashboard,
  Mail,
  Globe,
  Users,
  ListOrdered,
  LineChart,
  MessageCircle,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createPrefetchUtils } from '@/lib/prefetch'

const navItems: Array<{
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  prefetch?: string
}> = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, prefetch: 'prefetchDashboard' },
  { href: '/campaigns', label: 'Outbound Campaigns', icon: Mail, prefetch: 'prefetchCampaigns' },
  { href: '/domains', label: 'Sending Health', icon: Globe, prefetch: 'prefetchDomains' },
  { href: '/contacts', label: 'Prospects', icon: Users, prefetch: 'prefetchContacts' },
  { href: '/sequences', label: 'Message Sequences', icon: ListOrdered, prefetch: 'prefetchSequences' },
  { href: '/analytics', label: 'Performance', icon: LineChart, prefetch: 'prefetchAnalytics' },
  { href: '/inbox', label: 'Conversations', icon: MessageCircle, prefetch: 'prefetchInbox' },
  { href: '/settings', label: 'Workspace', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const prefetch = createPrefetchUtils(queryClient)

  const handleNavClick = () => {
    setOpen(false)
  }

  const handleNavHover = async (prefetchKey: string | undefined) => {
    if (!prefetchKey) return
    try {
      await (prefetch as any)[prefetchKey]()
    } catch (error) {
      console.error(`Prefetch failed for ${prefetchKey}:`, error)
    }
  }

  return (
    <>
      {/* Mobile toggle */}
      <div className="fixed top-0 left-0 right-0 z-40 md:hidden flex items-center justify-between bg-sidebar border-b border-sidebar-border px-4 py-3">
        <h1 className="font-bold text-lg">Xavira Orbit</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 w-64 bg-sidebar border-r border-sidebar-border transition-all duration-300 z-30 md:relative md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 md:top-0 top-16`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="hidden md:flex items-center gap-2 px-6 py-4 border-b border-sidebar-border">
            <div className="w-8 h-8 rounded-md bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold text-sm">
              XO
            </div>
            <div>
              <h1 className="font-bold text-lg">Xavira Orbit</h1>
              <p className="text-xs text-sidebar-foreground/80">Lead Generation Infrastructure</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-2">
              {navItems.map((item) => {
                const isActive = pathname.startsWith(item.href)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={handleNavClick}
                    onMouseEnter={() => handleNavHover(item.prefetch)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }`}
                  >
                    <Icon className="w-4 h-4 opacity-90" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </nav>

          {/* Footer */}
          <div className="border-t border-sidebar-border px-4 py-4 space-y-2">
            <div className="text-xs text-sidebar-foreground">
              <p className="font-semibold">Xavira Orbit</p>
              <p className="text-sidebar-foreground/60">Enterprise Edition</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  )
}
