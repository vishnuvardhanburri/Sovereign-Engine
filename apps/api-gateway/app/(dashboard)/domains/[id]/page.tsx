'use client'

import { useQuery } from '@tanstack/react-query'
import { IdentitiesList } from '@/components/identities-list'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface Domain {
  id: number
  domain: string
  status: 'active' | 'paused' | 'warming'
  daily_limit: number
  sent_today: number
  health_score: number
  bounce_rate: number
  reply_rate: number
  identity_count: number
  today_sent: number
}

export default function DomainDetailPage({ params }: { params: { id: string } }) {
  const domainId = parseInt(params.id)

  const { data: domain, isLoading } = useQuery({
    queryKey: ['domain', domainId],
    queryFn: async () => {
      const res = await fetch('/api/domains')
      if (!res.ok) throw new Error('Failed to fetch domains')
      const domains = await res.json()
      return domains.find((d: Domain) => d.id === domainId) || null
    },
    refetchInterval: 30000,
  })

  if (isLoading || !domain) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-700'
      case 'paused':
        return 'bg-yellow-500/10 text-yellow-700'
      case 'warming':
        return 'bg-blue-500/10 text-blue-700'
      default:
        return 'bg-gray-500/10 text-gray-700'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/domains" className="hover:opacity-70">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold">{domain.domain}</h1>
          <Badge className={getStatusColor(domain.status)}>
            {domain.status}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Health Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-2xl font-bold">{domain.health_score.toFixed(0)}</p>
              <Progress value={domain.health_score} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Daily Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-2xl font-bold">
                {domain.sent_today} <span className="text-sm font-normal text-muted-foreground">/ {domain.daily_limit}</span>
              </p>
              <Progress
                value={(domain.sent_today / domain.daily_limit) * 100}
                className="h-2"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-sm">Bounce:</span>
                <span className="font-semibold">{domain.bounce_rate.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Reply:</span>
                <span className="font-semibold">{domain.reply_rate.toFixed(1)}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <IdentitiesList domainId={domainId} />
    </div>
  )
}
