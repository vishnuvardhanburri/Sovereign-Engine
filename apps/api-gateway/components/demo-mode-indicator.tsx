'use client'

import { useEffect, useState } from 'react'
import { FlaskConical, Loader2, Power } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type DemoStateResponse = {
  ok: boolean
  data?: {
    enabled: boolean
    updatedAt: string
  }
}

export function DemoModeIndicator() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch('/api/demo/state', { cache: 'no-store' })
        const payload = (await response.json()) as DemoStateResponse
        if (!cancelled) setEnabled(Boolean(payload.data?.enabled))
      } catch {
        if (!cancelled) setEnabled(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const timer = window.setInterval(load, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  async function toggle() {
    setSaving(true)
    try {
      const response = await fetch('/api/demo/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      })
      const payload = (await response.json()) as DemoStateResponse
      setEnabled(Boolean(payload.data?.enabled ?? !enabled))
    } catch {
      setEnabled((value) => !value)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="hidden items-center gap-2 rounded-full border border-border bg-background/70 px-2 py-1 md:flex">
      <Badge
        variant="outline"
        className={
          enabled
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600'
            : 'border-slate-500/20 bg-slate-500/10 text-muted-foreground'
        }
      >
        <FlaskConical className="mr-1 h-3 w-3" />
        {loading ? 'Checking' : enabled ? 'Demo Safe' : 'Live Mode'}
      </Badge>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 rounded-full px-2 text-xs"
        onClick={toggle}
        disabled={saving || loading}
        title={enabled ? 'Turn off synthetic demo overlay' : 'Turn on synthetic demo overlay'}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
      </Button>
    </div>
  )
}
