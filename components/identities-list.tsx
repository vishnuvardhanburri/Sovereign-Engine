'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Identity {
  id: number
  email: string
  daily_limit: number
  sent_today: number
  last_sent_at: string | null
  status: 'active' | 'paused' | 'inactive'
  created_at: string
}

interface IdentitiesListProps {
  domainId: number
}

export function IdentitiesList({ domainId }: IdentitiesListProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [dailyLimit, setDailyLimit] = useState('50')

  const { data: identities = [], isLoading } = useQuery({
    queryKey: ['identities', domainId],
    queryFn: async () => {
      const res = await fetch(`/api/identities?domain_id=${domainId}`)
      if (!res.ok) throw new Error('Failed to fetch identities')
      return res.json()
    },
    enabled: !!domainId,
    refetchInterval: 30000,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain_id: domainId,
          email,
          daily_limit: parseInt(dailyLimit),
        }),
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to create identity')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['identities', domainId] })
      toast.success('Identity added')
      setEmail('')
      setDailyLimit('50')
      setOpen(false)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      toast.error('Email is required')
      return
    }
    createMutation.mutate()
  }

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Email Identities</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add Identity
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Email Identity</DialogTitle>
              <DialogDescription>
                Add a new email address for this domain.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="sender@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={createMutation.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="limit">Daily Limit</Label>
                <Input
                  id="limit"
                  type="number"
                  min="1"
                  max="500"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                  disabled={createMutation.isPending}
                />
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
                  disabled={createMutation.isPending || !email.trim()}
                >
                  {createMutation.isPending ? 'Adding...' : 'Add'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {identities.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-muted-foreground">No identities yet</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Today&apos;s Usage</TableHead>
                <TableHead>Last Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {identities.map((identity: Identity) => (
                <TableRow key={identity.id}>
                  <TableCell className="font-medium">{identity.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        identity.status === 'active' ? 'default' : 'secondary'
                      }
                    >
                      {identity.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {identity.sent_today} / {identity.daily_limit}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {identity.last_sent_at
                      ? formatDistanceToNow(new Date(identity.last_sent_at), {
                          addSuffix: true,
                        })
                      : 'Never'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
