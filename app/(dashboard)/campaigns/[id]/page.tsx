'use client'

import Link from 'next/link'
import { useCampaign, useSequence } from '@/lib/hooks'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { ArrowLeft, Mail, MessageSquare, TrendingDown, TrendingUp } from 'lucide-react'

export default function CampaignDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { data: campaign, isLoading: campaignLoading } = useCampaign(params.id)
  const { data: sequence, isLoading: sequenceLoading } = useSequence(
    campaign?.sequenceId || ''
  )

  if (campaignLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">Campaign not found</p>
        <Link href="/campaigns">
          <Button variant="outline">Back to Campaigns</Button>
        </Link>
      </div>
    )
  }

  const stats = [
    {
      label: 'Total Sent',
      value: campaign.sent,
      icon: Mail,
      color: 'text-blue-500',
    },
    {
      label: 'Replies',
      value: campaign.replies,
      icon: MessageSquare,
      color: 'text-green-500',
    },
    {
      label: 'Open Rate',
      value: `${campaign.openRate}%`,
      icon: TrendingUp,
      color: 'text-purple-500',
    },
    {
      label: 'Bounce Rate',
      value: `${campaign.bounceRate}%`,
      icon: TrendingDown,
      color: 'text-red-500',
    },
  ]

  return (
    <div className="space-y-6">
      <Link href="/campaigns">
        <Button variant="ghost" className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Campaigns
        </Button>
      </Link>

      <div>
        <h1 className="text-3xl font-bold">{campaign.name}</h1>
        <p className="text-muted-foreground">
          Created on {campaign.createdAt.toLocaleDateString()}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
                <Icon className={`w-4 h-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Contacts and Sequence Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Contacts</span>
                <span className="font-semibold">{campaign.contactCount}</span>
              </div>
              <Link href={`/contacts?campaign=${params.id}`}>
                <Button className="w-full mt-4">View Campaign Contacts</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sequence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sequence Name</span>
                <span className="font-semibold">{campaign.sequenceName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Steps</span>
                <span className="font-semibold">{sequence?.steps.length || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sequence Steps */}
      {sequence && sequence.steps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sequence Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {sequence.steps.map((step, idx) => (
                <AccordionItem key={step.id} value={step.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 text-left">
                      <span className="font-semibold">Step {idx + 1}</span>
                      <span className="text-sm text-muted-foreground">
                        Day {step.day}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {step.subject}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 pt-2">
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground mb-1">
                          Subject:
                        </p>
                        <p className="text-sm">{step.subject}</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground mb-1">
                          Email Body:
                        </p>
                        <p className="text-sm whitespace-pre-line bg-muted p-3 rounded">
                          {step.body}
                        </p>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
