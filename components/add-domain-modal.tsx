'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { toast } from 'sonner'
import { Plus } from 'lucide-react'

export function AddDomainModal() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [domain, setDomain] = useState('')
  const [dailyLimit, setDailyLimit] = useState('50')

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          daily_limit: parseInt(dailyLimit),
        }),
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to create domain')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] })
      toast.success('Domain added successfully')
      setDomain('')
      setDailyLimit('50')
      setOpen(false)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!domain.trim()) {
      toast.error('Domain is required')
      return
    }
    createMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Domain
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Domain</DialogTitle>
          <DialogDescription>
            Add a domain to start sending cold emails with rate control.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={createMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Enter your sending domain (e.g., email.example.com)
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-limit">Daily Limit</Label>
            <Input
              id="daily-limit"
              type="number"
              min="1"
              max="500"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              disabled={createMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Initial daily limit (1-500 emails/day)
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !domain.trim()}
            >
              {createMutation.isPending ? 'Adding...' : 'Add Domain'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
