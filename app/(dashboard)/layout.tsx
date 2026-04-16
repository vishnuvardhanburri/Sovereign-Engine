'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/store'
import { AppLayout } from '@/components/app-layout'
import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!user) {
      router.push('/login')
    }
  }, [user, router])

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="space-y-4 w-96">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  return <AppLayout>{children}</AppLayout>
}
