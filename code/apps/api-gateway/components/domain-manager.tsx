'use client'

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
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { MoreHorizontal, Pause, Play, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface Domain {
  id: number
  domain: string
  status: 'active' | 'paused' | 'warming'
  daily_limit: number
  sent_today: number
  health_score: number
  bounce_rate: number
  reply_rate: number
  identity_count: number
  today_sent: number
  capacity_remaining: number
}

export function DomainManager() {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<Domain | null>(null)
  const [deleteOptIn, setDeleteOptIn] = useState(false)
  const [deleteTyped, setDeleteTyped] = useState('')

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ['domains'],
    queryFn: async () => {
      const res = await fetch('/api/domains')
      if (!res.ok) throw new Error('Failed to fetch domains')
      return res.json()
    },
    refetchInterval: 30000,
  })

  const pauseMutation = useMutation({
    mutationFn: async (domainId: number) => {
      const res = await fetch(`/api/domains/${domainId}/pause`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to pause domain')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] })
      toast.success('Domain paused')
    },
    onError: () => {
      toast.error('Failed to pause domain')
    },
  })

  const resumeMutation = useMutation({
    mutationFn: async (domainId: number) => {
      const res = await fetch(`/api/domains/${domainId}/resume`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to resume domain')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] })
      toast.success('Domain resumed')
    },
    onError: () => {
      toast.error('Failed to resume domain')
    },
  })

  const deleteEnabled = useMemo(() => {
    if (!deleteTarget) return false
    return deleteOptIn && deleteTyped.trim().toLowerCase() === deleteTarget.domain.trim().toLowerCase()
  }, [deleteOptIn, deleteTarget, deleteTyped])

  const deleteMutation = useMutation({
    mutationFn: async (domainId: number) => {
      const res = await fetch(`/api/domains/${domainId}?confirm=true`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Failed to delete domain')
      }
      return true
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] })
      toast.success('Domain deleted')
      setDeleteTarget(null)
      setDeleteOptIn(false)
      setDeleteTyped('')
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to delete domain')
    },
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-700 hover:bg-green-500/20'
      case 'paused':
        return 'bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20'
      case 'warming':
        return 'bg-blue-500/10 text-blue-700 hover:bg-blue-500/20'
      default:
        return 'bg-gray-500/10 text-gray-700 hover:bg-gray-500/20'
    }
  }

  const getHealthColor = (score: number) => {
    if (score >= 90) return 'text-green-600'
    if (score >= 70) return 'text-yellow-600'
    return 'text-red-600'
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Domain</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Usage</TableHead>
            <TableHead>Metrics</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {domains.map((domain: Domain) => (
            <TableRow key={domain.id}>
              <TableCell className="font-medium">{domain.domain}</TableCell>
              <TableCell>
                <Badge className={getStatusColor(domain.status)}>
                  {domain.status}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${getHealthColor(domain.health_score)}`}>
                    {domain.health_score.toFixed(0)}
                  </span>
                  <Progress
                    value={domain.health_score}
                    className="w-20 h-2"
                  />
                </div>
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <div className="text-sm">
                    {domain.sent_today} / {domain.daily_limit}
                  </div>
                  <Progress
                    value={(domain.sent_today / domain.daily_limit) * 100}
                    className="w-32 h-2"
                  />
                </div>
              </TableCell>
              <TableCell className="text-sm">
                <div>Bounce: {domain.bounce_rate.toFixed(1)}%</div>
                <div>Reply: {domain.reply_rate.toFixed(1)}%</div>
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {domain.status === 'active' ? (
                      <DropdownMenuItem
                        onClick={() => pauseMutation.mutate(domain.id)}
                        disabled={pauseMutation.isPending}
                      >
                        <Pause className="mr-2 h-4 w-4" />
                        Pause
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() => resumeMutation.mutate(domain.id)}
                        disabled={resumeMutation.isPending}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Resume
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        setDeleteTarget(domain)
                        setDeleteOptIn(false)
                        setDeleteTyped('')
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete domain…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete domain</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the domain and all identities under it. Historical events will be kept, but the domain will be removed from your configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Checkbox
                checked={deleteOptIn}
                onCheckedChange={(v) => setDeleteOptIn(Boolean(v))}
                id="domain-delete-optin"
              />
              <label htmlFor="domain-delete-optin" className="text-sm leading-snug">
                I understand this action is irreversible.
              </label>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Type <span className="font-mono">{deleteTarget?.domain ?? ''}</span> to confirm.
              </div>
              <Input
                value={deleteTyped}
                onChange={(e) => setDeleteTyped(e.target.value)}
                placeholder="domain.com"
                autoFocus
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteTarget(null)
                setDeleteOptIn(false)
                setDeleteTyped('')
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!deleteEnabled || deleteMutation.isPending || !deleteTarget}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
