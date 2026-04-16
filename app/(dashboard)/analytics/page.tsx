'use client'

import { useAnalytics, useCampaigns } from '@/lib/hooks'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  Table as UITable,
  TableHead as UITableHead,
  TableHeader as UITableHeader,
  TableBody as UITableBody,
  TableCell as UITableCell,
  TableRow as UITableRow,
} from '@/components/ui/table'

export default function AnalyticsPage() {
  const { data: analytics, isLoading: analyticsLoading } = useAnalytics()
  const { data: campaigns } = useCampaigns()

  const chartData = analytics?.map((a) => ({
    campaign: a.campaignName.substring(0, 10),
    replies: a.repliesCount,
    bounce: a.bounceRate,
    open: a.openRate,
  })) || []

  const replyRateChartData = analytics?.map((a) => ({
    campaign: a.campaignName,
    rate: a.replyRate,
  })) || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Performance Analytics</h1>
        <p className="text-muted-foreground">
          Analyze ROI and metrics across your outbound campaigns
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Campaigns',
            value: campaigns?.length || 0,
          },
          {
            label: 'Avg Reply Rate',
            value: analytics
              ? Math.round(
                  analytics.reduce((sum, a) => sum + a.replyRate, 0) /
                    analytics.length
                )
              : 0,
            suffix: '%',
          },
          {
            label: 'Avg Open Rate',
            value: analytics
              ? Math.round(
                  analytics.reduce((sum, a) => sum + a.openRate, 0) /
                    analytics.length
                )
              : 0,
            suffix: '%',
          },
          {
            label: 'Avg Bounce Rate',
            value: analytics
              ? Math.round(
                  analytics.reduce((sum, a) => sum + a.bounceRate, 0) /
                    analytics.length
                )
              : 0,
            suffix: '%',
          },
        ].map((stat, idx) => (
          <Card key={idx}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analyticsLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <div className="text-2xl font-bold">
                  {stat.value}
                  {stat.suffix}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reply Rate Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Reply Rate by Campaign</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <Skeleton className="h-80" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={replyRateChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="campaign" width={60} angle={-45} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="rate" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Bounce Rate Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Performance Metrics by Campaign</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <Skeleton className="h-80" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="campaign" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="replies" fill="hsl(var(--primary))" />
                  <Bar dataKey="bounce" fill="hsl(var(--destructive))" />
                  <Bar dataKey="open" fill="hsl(var(--secondary))" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle>Campaign Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <UITable>
              <UITableHeader>
                <UITableRow>
                  <UITableHead>Campaign Name</UITableHead>
                  <UITableHead className="text-right">Sent</UITableHead>
                  <UITableHead className="text-right">Replies</UITableHead>
                  <UITableHead className="text-right">Reply Rate</UITableHead>
                  <UITableHead className="text-right">Open Rate</UITableHead>
                  <UITableHead className="text-right">Bounce Rate</UITableHead>
                </UITableRow>
              </UITableHeader>
              <UITableBody>
                {analyticsLoading ? (
                  Array(5)
                    .fill(0)
                    .map((_, i) => (
                      <UITableRow key={i}>
                        {Array(6)
                          .fill(0)
                          .map((_, j) => (
                            <UITableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </UITableCell>
                          ))}
                      </UITableRow>
                    ))
                ) : analytics && analytics.length > 0 ? (
                  analytics.map((a) => (
                    <UITableRow key={a.campaignName}>
                      <UITableCell className="font-medium">
                        {a.campaignName}
                      </UITableCell>
                      <UITableCell className="text-right">
                        {a.sentCount}
                      </UITableCell>
                      <UITableCell className="text-right">
                        {a.repliesCount}
                      </UITableCell>
                      <UITableCell className="text-right">
                        {a.replyRate}%
                      </UITableCell>
                      <UITableCell className="text-right">
                        {a.openRate}%
                      </UITableCell>
                      <UITableCell className="text-right">
                        {a.bounceRate}%
                      </UITableCell>
                    </UITableRow>
                  ))
                ) : (
                  <UITableRow>
                    <UITableCell colSpan={6} className="text-center py-8">
                      No data available
                    </UITableCell>
                  </UITableRow>
                )}
              </UITableBody>
            </UITable>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
