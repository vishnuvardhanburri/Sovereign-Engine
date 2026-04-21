'use client'

import { useState } from 'react'
import { useBulkCreateContacts } from '@/lib/hooks'
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
import { Spinner } from '@/components/ui/spinner'
import { Plus } from 'lucide-react'

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function AddContactModal() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const { mutate: bulkCreate, isPending } = useBulkCreateContacts()

  const canSubmit = isLikelyEmail(email)

  const handleSubmit = () => {
    if (!canSubmit) return
    bulkCreate(
      [
        {
          email: email.trim(),
          name: name.trim(),
          company: company.trim(),
        },
      ],
      {
        onSuccess: () => {
          setEmail('')
          setName('')
          setCompany('')
          setOpen(false)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Prospect
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Prospect</DialogTitle>
          <DialogDescription>Add one prospect manually. Email is required.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prospect-email">Email</Label>
            <Input
              id="prospect-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prospect-name">Name</Label>
            <Input
              id="prospect-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prospect-company">Company</Label>
            <Input
              id="prospect-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || isPending} className="gap-2">
              {isPending && <Spinner className="w-4 h-4" />}
              Save Prospect
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

