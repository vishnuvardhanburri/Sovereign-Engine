'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

export default function DemoPage() {
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit() {
    if (!email.trim()) {
      toast.error('Enter your email')
      return
    }
    setIsSubmitting(true)
    try {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-id': '1' },
        body: JSON.stringify({
          type: 'clicked',
          metadata: { action: 'demo_request', email, company },
        }),
      })
      toast.success('Request received. We will contact you shortly.')
      setEmail('')
      setCompany('')
    } catch {
      toast.error('Failed to submit')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800">
      <Card className="w-full max-w-lg border-slate-700 bg-slate-900">
        <CardHeader>
          <CardTitle>Book a demo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-300">
            We will walk you through the sending engine, reply intelligence, and deliverability controls.
          </p>
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="bg-slate-800 border-slate-700" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company">Company</Label>
            <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" className="bg-slate-800 border-slate-700" />
          </div>
          <Button className="w-full bg-blue-600 hover:bg-blue-700" disabled={isSubmitting} onClick={submit}>
            {isSubmitting ? 'Submitting...' : 'Request demo'}
          </Button>
          <div className="text-xs text-slate-400">
            <Link className="underline underline-offset-4" href="/login">Back to sign in</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

