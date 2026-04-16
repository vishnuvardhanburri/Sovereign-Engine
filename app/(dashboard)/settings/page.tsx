'use client'

import { useState, useEffect } from 'react'
import { useUI, useAuth } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
]

export default function SettingsPage() {
  const { user } = useAuth()
  const { timezone, setTimezone, autoUnsubscribeBounce, setAutoUnsubscribeBounce } = useUI()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (saved) {
      toast.success('Settings saved!')
      const timer = setTimeout(() => setSaved(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [saved])

  const handleTimezoneChange = (value: string) => {
    setTimezone(value)
    setSaved(true)
  }

  const handleAutoUnsubscribeChange = () => {
    setAutoUnsubscribeBounce(!autoUnsubscribeBounce)
    setSaved(true)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Workspace Settings</h1>
        <p className="text-muted-foreground">Manage your Xavira Orbit workspace</p>
      </div>

      {/* Product Info */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Xavira Orbit
          </CardTitle>
          <CardDescription>Outbound Infrastructure for Scalable Lead Generation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Enterprise-grade outbound platform built for sales teams and agencies
          </p>
          <div className="grid grid-cols-2 gap-4 pt-3">
            <div>
              <p className="text-xs text-muted-foreground">Version</p>
              <p className="font-medium">1.0</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Edition</p>
              <p className="font-medium">Enterprise</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Email
            </Label>
            <div className="px-3 py-2 bg-muted rounded text-sm">
              {user?.email || 'Not set'}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium">
              Name
            </Label>
            <div className="px-3 py-2 bg-muted rounded text-sm">
              {user?.name || 'Not set'}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Email Settings</CardTitle>
          <CardDescription>Configure how your campaigns are sent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Timezone */}
          <div className="space-y-2">
            <Label htmlFor="timezone" className="text-sm font-medium">
              Send Time Timezone
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              All campaigns will be sent at the scheduled time in this timezone
            </p>
            <Select value={timezone} onValueChange={handleTimezoneChange}>
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Auto-unsubscribe */}
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm font-medium">
                  Auto-unsubscribe on bounce
                </Label>
                <p className="text-xs text-muted-foreground">
                  Automatically remove bounced emails from future campaigns
                </p>
              </div>
              <Switch
                checked={autoUnsubscribeBounce}
                onCheckedChange={handleAutoUnsubscribeChange}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API & Integrations */}
      <Card>
        <CardHeader>
          <CardTitle>API & Integrations</CardTitle>
          <CardDescription>Connect external tools and services</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded">
              <div>
                <p className="font-medium text-sm">Zapier</p>
                <p className="text-xs text-muted-foreground">Automate workflows</p>
              </div>
              <Button variant="outline" size="sm" disabled>
                Coming Soon
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 border rounded">
              <div>
                <p className="font-medium text-sm">Slack</p>
                <p className="text-xs text-muted-foreground">Get notifications</p>
              </div>
              <Button variant="outline" size="sm" disabled>
                Coming Soon
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 border rounded">
              <div>
                <p className="font-medium text-sm">Gmail</p>
                <p className="text-xs text-muted-foreground">Sync replies</p>
              </div>
              <Button variant="outline" size="sm" disabled>
                Coming Soon
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data & Privacy */}
      <Card>
        <CardHeader>
          <CardTitle>Data & Privacy</CardTitle>
          <CardDescription>Manage your data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This is a demo application. Your data is stored locally in the browser.
          </p>
          <Button variant="outline" disabled>
            Export My Data
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
