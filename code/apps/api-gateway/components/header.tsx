'use client'

import { useAuth } from '@/lib/store'
import { useRouter, usePathname } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ThemeToggle } from '@/components/theme-toggle'
import { DemoModeIndicator } from '@/components/demo-mode-indicator'
import { RecordingModeToggle } from '@/components/recording-mode-toggle'
import { ProductionReadinessBadge } from '@/components/production-readiness-badge'

export function Header() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  // Don't show header on login page
  if (pathname.startsWith('/login') || pathname.startsWith('/(auth)')) {
    return null
  }

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const userInitials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : '?'

  return (
    <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-border bg-card md:fixed md:top-0 md:right-0 md:left-64 z-20">
      <div className="hidden md:block">
        <h2 className="text-sm text-muted-foreground">Sovereign Engine</h2>
        <p className="text-xs text-muted-foreground">Outbound Infrastructure</p>
      </div>

      <div className="flex-1" /> {/* Spacer */}

      <div className="mr-2">
        <DemoModeIndicator />
      </div>

      <div className="mr-2">
        <ProductionReadinessBadge />
      </div>

      <div className="mr-2 hidden sm:block">
        <RecordingModeToggle />
      </div>

      <div className="mr-2">
        <ThemeToggle />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-8 w-8 rounded-full">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
            {user?.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="/settings">Settings</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
