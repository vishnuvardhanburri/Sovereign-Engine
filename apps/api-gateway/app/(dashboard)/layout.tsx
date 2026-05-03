'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/store'
import { AppLayout } from '@/components/app-layout'
import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isLoading, bootstrap } = useAuth()
  const router = useRouter()
  const [hasBootstrapped, setHasBootstrapped] = useState(false)

  useEffect(() => {
    if (user && !hasBootstrapped) {
      setHasBootstrapped(true)
      return
    }
    if (!user && !isLoading && !hasBootstrapped) {
      void bootstrap().finally(() => setHasBootstrapped(true))
    }
  }, [user, isLoading, hasBootstrapped, bootstrap])

  useEffect(() => {
    if (!user && !isLoading && hasBootstrapped) {
      router.push('/login')
    }
  }, [user, isLoading, hasBootstrapped, router])

  if (!user || !hasBootstrapped) {
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
