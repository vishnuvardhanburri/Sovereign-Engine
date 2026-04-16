'use client'

import { useState } from 'react'
import { useCreateSequence, useUpdateSequence } from '@/lib/hooks'
import { Sequence, SequenceStep } from '@/lib/api'
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
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Trash2, Plus } from 'lucide-react'

interface SequenceEditorProps {
  sequence?: Sequence
  trigger?: React.ReactNode
}

export function SequenceEditor({ sequence, trigger }: SequenceEditorProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(sequence?.name || '')
  const [steps, setSteps] = useState<SequenceStep[]>(sequence?.steps || [])
  const { mutate: createSequence, isPending: creatingSequence } = useCreateSequence()
  const { mutate: updateSequence, isPending: updatingSequence } = useUpdateSequence()

  const isPending = creatingSequence || updatingSequence

  const handleAddStep = () => {
    const newStep: SequenceStep = {
      id: `step_${Date.now()}`,
      day: steps.length > 0 ? steps[steps.length - 1].day + 2 : 1,
      subject: '',
      body: '',
    }
    setSteps([...steps, newStep])
  }

  const handleUpdateStep = (id: string, updates: Partial<SequenceStep>) => {
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...updates } : s)))
  }

  const handleRemoveStep = (id: string) => {
    setSteps(steps.filter((s) => s.id !== id))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || steps.length === 0) return

    const data = { name, steps }

    if (sequence) {
      updateSequence(
        { id: sequence.id, data },
        {
          onSuccess: () => {
            setOpen(false)
          },
        }
      )
    } else {
      createSequence(data, {
        onSuccess: () => {
          setName('')
          setSteps([])
          setOpen(false)
        },
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button>Create Sequence</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {sequence ? 'Edit Sequence' : 'Create New Sequence'}
          </DialogTitle>
          <DialogDescription>
            {sequence
              ? 'Update your email sequence'
              : 'Create a new email sequence with multiple steps'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="seq-name">Sequence Name</Label>
            <Input
              id="seq-name"
              placeholder="e.g., Initial Outreach"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Email Steps ({steps.length})</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddStep}
                disabled={isPending}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Step
              </Button>
            </div>

            <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
              {steps.length > 0 ? (
                steps.map((step, idx) => (
                  <Card key={step.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          Step {idx + 1}
                        </CardTitle>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStep(step.id)}
                          disabled={isPending}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Day</Label>
                          <Input
                            type="number"
                            min="1"
                            value={step.day}
                            onChange={(e) =>
                              handleUpdateStep(step.id, {
                                day: parseInt(e.target.value) || 1,
                              })
                            }
                            disabled={isPending}
                            className="text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Subject</Label>
                          <Input
                            value={step.subject}
                            onChange={(e) =>
                              handleUpdateStep(step.id, { subject: e.target.value })
                            }
                            placeholder="Email subject"
                            disabled={isPending}
                            className="text-sm"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Email Body</Label>
                        <Textarea
                          value={step.body}
                          onChange={(e) =>
                            handleUpdateStep(step.id, { body: e.target.value })
                          }
                          placeholder="Email content. Use {{FirstName}} and {{Company}} for variables"
                          disabled={isPending}
                          className="text-sm min-h-20"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Available variables: {'{'}
                          {'{FirstName}'} {'{Company}'} {'}'}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Add a step to get started
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !name || steps.length === 0}
              className="gap-2"
            >
              {isPending && <Spinner className="w-4 h-4" />}
              {sequence ? 'Update Sequence' : 'Create Sequence'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
