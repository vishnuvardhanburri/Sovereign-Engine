'use client'

import { useState } from 'react'
import { Reply } from '@/lib/api'
import { useUpdateReplyStatus } from '@/lib/hooks'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Eye, ThumbsUp, ThumbsDown } from 'lucide-react'

interface ReplyDetailModalProps {
  reply: Reply
}

export function ReplyDetailModal({ reply }: ReplyDetailModalProps) {
  const [open, setOpen] = useState(false)
  const { mutate: updateStatus, isPending } = useUpdateReplyStatus()

  const handleStatusChange = (status: 'interested' | 'not_interested') => {
    updateStatus({ id: reply.id, status }, {
      onSuccess: () => {
        setOpen(false)
      },
    })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'interested':
        return 'bg-green-500/10 text-green-500'
      case 'not_interested':
        return 'bg-red-500/10 text-red-500'
      case 'unread':
      default:
        return 'bg-blue-500/10 text-blue-500'
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Eye className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email Conversation</DialogTitle>
        </DialogHeader>

        {/* Contact Info */}
        <div className="space-y-3 pb-4 border-b">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold">{reply.fromName}</p>
              <p className="text-sm text-muted-foreground">{reply.fromEmail}</p>
            </div>
            <Badge className={getStatusColor(reply.status)}>
              {reply.status}
            </Badge>
          </div>
        </div>

        {/* Email Thread */}
        <div className="space-y-4">
          {reply.messages.map((msg) => (
            <Card
              key={msg.id}
              className={`p-4 ${msg.isIncoming ? 'border-primary' : ''}`}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-sm">
                    {msg.isIncoming ? 'From: ' : 'To: '}
                    {msg.isIncoming ? msg.from : msg.to}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {msg.date.toLocaleString()}
                  </p>
                </div>
                {msg.isIncoming && (
                  <Badge variant="outline" className="text-xs">
                    Incoming
                  </Badge>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Subject: {msg.subject}
                </p>
                <p className="text-sm whitespace-pre-wrap bg-muted p-2 rounded">
                  {msg.body}
                </p>
              </div>
            </Card>
          ))}
        </div>

        {/* Actions */}
        <div className="pt-4 border-t space-y-2">
          <p className="text-sm font-medium">Mark this lead as:</p>
          <div className="flex gap-2">
            <Button
              onClick={() => handleStatusChange('interested')}
              disabled={isPending || reply.status === 'interested'}
              className="gap-2 flex-1"
              variant={reply.status === 'interested' ? 'default' : 'outline'}
            >
              {isPending && <Spinner className="w-4 h-4" />}
              <ThumbsUp className="w-4 h-4" />
              Interested
            </Button>
            <Button
              onClick={() => handleStatusChange('not_interested')}
              disabled={isPending || reply.status === 'not_interested'}
              className="gap-2 flex-1"
              variant={reply.status === 'not_interested' ? 'default' : 'outline'}
            >
              {isPending && <Spinner className="w-4 h-4" />}
              <ThumbsDown className="w-4 h-4" />
              Not Interested
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
