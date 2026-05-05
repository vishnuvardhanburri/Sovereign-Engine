'use client'

import { useState } from 'react'
import { useSequences, useCreateCampaign } from '@/lib/hooks'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

export function CreateCampaignModal() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [sequenceId, setSequenceId] = useState('')
  const { data: sequences, isLoading: sequencesLoading } = useSequences()
  const { mutate: createCampaign, isPending } = useCreateCampaign()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !sequenceId) return

    createCampaign(
      {
        name,
        sequenceId,
        sequenceName: sequences?.find((s) => s.id === sequenceId)?.name || '',
      },
      {
        onSuccess: () => {
          setName('')
          setSequenceId('')
          setOpen(false)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="shadow-sm">Create Campaign</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Campaign</DialogTitle>
          <DialogDescription>
            Set up a new email campaign with your selected sequence
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Campaign Name</Label>
            <Input
              id="name"
              placeholder="e.g., Q1 Outreach"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sequence">Select Sequence</Label>
            <Select value={sequenceId} onValueChange={setSequenceId} disabled={sequencesLoading || isPending}>
              <SelectTrigger id="sequence">
                <SelectValue placeholder="Choose a sequence..." />
              </SelectTrigger>
              <SelectContent>
                {sequences?.map((seq) => (
                  <SelectItem key={seq.id} value={seq.id}>
                    {seq.name} ({seq.steps.length} steps)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !name || !sequenceId}
              className="gap-2"
            >
              {isPending && <Spinner className="w-4 h-4" />}
              Create Campaign
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
