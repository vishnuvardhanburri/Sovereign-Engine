'use client'

import { useDashboardStats, useChartData, useActivityFeed } from '@/lib/hooks'
import Link from 'next/link'
import type React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Mail, MessageSquare, TrendingUp, AlertCircle, Activity, ArrowRight } from 'lucide-react'

type StatCardProps = {
  title: string
  value: number | string
  icon: React.ComponentType<{ className: string }>
  loading: boolean
}

function StatCard({ title, value, icon: Icon, loading }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
      </CardContent>
    </Card>
  )
}

type ActivityItem = {
  id: string | number
  timestamp: string | Date
  description: string
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats()
  const { data: chartData, isLoading: chartLoading } = useChartData()
  const { data: activities, isLoading: activitiesLoading } = useActivityFeed()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Outbound Performance</h1>
        <p className="text-muted-foreground">Real-time insights into your lead generation campaigns</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quick start</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            1. Add a sending domain and at least one email identity in{' '}
            <Link className="text-foreground underline underline-offset-4" href="/domains">
              Sending Health
            </Link>
            .
          </p>
          <p>
            2. Import prospects in{' '}
            <Link className="text-foreground underline underline-offset-4" href="/contacts">
              Prospects
            </Link>
            .
          </p>
          <p>
            3. Create your message steps in{' '}
            <Link className="text-foreground underline underline-offset-4" href="/sequences">
              Message Sequences
            </Link>
            .
          </p>
          <p>
            4. Create a campaign in{' '}
            <Link className="text-foreground underline underline-offset-4" href="/campaigns">
              Outbound Campaigns
            </Link>
            , then click Start to enqueue jobs.
          </p>
          <p className="flex items-center flex-wrap gap-2">
            5. Run the worker process to send emails (local):{' '}
            <code className="px-2 py-0.5 rounded bg-muted text-foreground">npm run worker:dev</code>
            <ArrowRight className="w-4 h-4 opacity-70" />
            <span>Emails are sent by the worker, not the API.</span>
          </p>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Emails Sent Today"
          value={stats?.emailsSentToday ?? 0}
          icon={Mail}
          loading={statsLoading}
        />
        <StatCard
          title="Replies"
          value={stats?.replies ?? 0}
          icon={MessageSquare}
          loading={statsLoading}
        />
        <StatCard
          title="Open Rate"
          value={stats ? `${stats.openRate}%` : '0%'}
          icon={TrendingUp}
          loading={statsLoading}
        />
        <StatCard
          title="Bounce Rate"
          value={stats ? `${stats.bounceRate}%` : '0%'}
          icon={AlertCircle}
          loading={statsLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Emails Sent Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {chartLoading ? (
              <Skeleton className="h-80" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="sent"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activitiesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                {(activities as ActivityItem[] | undefined)?.slice(0, 5).map((activity) => (
                  <div key={activity.id} className="border-l-2 border-primary pl-3 py-1">
                    <p className="font-medium text-xs text-muted-foreground">
                      {new Date(activity.timestamp).toLocaleTimeString()}
                    </p>
                    <p className="text-sm">{activity.description}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
