'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCampaigns, useInfrastructureControl } from '@/lib/hooks'
import { toast } from 'sonner'
import { AlertTriangle, PauseCircle, RefreshCcw, ShieldAlert, Zap } from 'lucide-react'
import { useViewMode } from '@/components/ai/view-mode'

type ConfirmAction =
  | { kind: 'heal' }
  | { kind: 'optimize' }
  | { kind: 'pauseCampaign'; campaignId: string }

async function pauseCampaign(campaignId: string): Promise<void> {
  const res = await fetch(`/api/campaigns/${campaignId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'paused' }),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json?.error || 'Failed to pause campaign')
  }
}

export function QuickActionsPanel() {
  const control = useInfrastructureControl()
  const { data: campaigns } = useCampaigns()
  const { viewMode } = useViewMode()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<ConfirmAction | null>(null)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [pausing, setPausing] = useState(false)

  const activeCampaigns = useMemo(() => (campaigns ?? []).filter((c) => c.status === 'active'), [campaigns])

  const openConfirm = (action: ConfirmAction) => {
    setPending(action)
    setConfirmOpen(true)
  }

  const confirmText = useMemo(() => {
    if (!pending) return { title: 'Confirm action', desc: 'Confirm to execute this action.' }
    if (pending.kind === 'heal') {
      return { title: 'Apply Fix', desc: 'Runs self-heal actions against the infrastructure. No email sending happens inside the API.' }
    }
    if (pending.kind === 'optimize') {
      return { title: 'Optimize Now', desc: 'Runs the optimizer to rebalance load and improve domain utilization.' }
    }
    return { title: 'Pause Campaign', desc: 'Pauses the selected campaign immediately.' }
  }, [pending])

  const execute = async () => {
    if (!pending) return
    try {
      if (pending.kind === 'heal') {
        control.mutate({ action: 'heal' })
        setConfirmOpen(false)
        return
      }
      if (pending.kind === 'optimize') {
        control.mutate({ action: 'optimize' })
        setConfirmOpen(false)
        return
      }
      if (pending.kind === 'pauseCampaign') {
        setPausing(true)
        await pauseCampaign(pending.campaignId)
        toast.success('Campaign paused')
        setConfirmOpen(false)
        return
      }
    } catch (e: any) {
      toast.error(e?.message || 'Action failed')
    } finally {
      setPausing(false)
    }
  }

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10 h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 opacity-80" />
          Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {viewMode === 'client' ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-muted-foreground">
            Client View is read-only. Switch to Operator Mode to execute actions.
          </div>
        ) : null}
        <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
          <div className="text-sm font-medium">Quick controls</div>
          <div className="grid grid-cols-1 gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => openConfirm({ kind: 'heal' })}
              disabled={control.isPending || viewMode === 'client'}
            >
              <ShieldAlert className="h-4 w-4" />
              Apply Fix
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => openConfirm({ kind: 'optimize' })}
              disabled={control.isPending || viewMode === 'client'}
            >
              <RefreshCcw className="h-4 w-4" />
              Optimize Now
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
          <div className="text-sm font-medium">Campaign control</div>
          <div className="space-y-2">
            <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
              <SelectTrigger className="bg-black/10 border-white/10">
                <SelectValue placeholder={activeCampaigns.length ? 'Select active campaign' : 'No active campaigns'} />
              </SelectTrigger>
              <SelectContent className="bg-slate-950 border-white/10">
                {activeCampaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="justify-start gap-2 w-full"
              onClick={() => openConfirm({ kind: 'pauseCampaign', campaignId: selectedCampaignId })}
              disabled={!selectedCampaignId || viewMode === 'client'}
            >
              <PauseCircle className="h-4 w-4" />
              Pause Campaign
            </Button>
          </div>
        </div>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {confirmText.title}
              </DialogTitle>
              <DialogDescription>{confirmText.desc}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={control.isPending || pausing}>
                Cancel
              </Button>
              <Button onClick={execute} disabled={control.isPending || pausing} className="gap-2">
                <AlertTriangle className="h-4 w-4" />
                Confirm
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
