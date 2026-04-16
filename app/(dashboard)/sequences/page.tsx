'use client'

import { useSequences } from '@/lib/hooks'
import { SequenceEditor } from '@/components/sequence-editor'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Mail, Edit } from 'lucide-react'

export default function SequencesPage() {
  const { data: sequences, isLoading } = useSequences()

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Message Sequences</h1>
          <p className="text-muted-foreground">
            Create multi-step message sequences for your outbound campaigns
          </p>
        </div>
        <SequenceEditor />
      </div>

      {/* Info Card */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900">
        <CardContent className="pt-6">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            💡 Sequences are email templates with multiple steps. Create one, then use it for multiple campaigns.
          </p>
        </CardContent>
      </Card>

      {/* Sequences Grid */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Your Sequences</h2>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array(3)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-48" />
              ))}
          </div>
        ) : sequences && sequences.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sequences.map((sequence) => (
              <Card key={sequence.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{sequence.name}</CardTitle>
                      <CardDescription>
                        {sequence.steps.length} step{sequence.steps.length !== 1 ? 's' : ''}
                      </CardDescription>
                    </div>
                    <Mail className="w-5 h-5 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    {sequence.steps.map((step, idx) => (
                      <div key={step.id} className="text-sm">
                        <p className="font-medium">
                          Step {idx + 1} - Day {step.day}
                        </p>
                        <p className="text-muted-foreground truncate">
                          {step.subject}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-3">
                      Last updated{' '}
                      {sequence.updatedAt.toLocaleDateString()}
                    </p>
                    <SequenceEditor
                      sequence={sequence}
                      trigger={
                        <Button size="sm" variant="outline" className="w-full">
                          <Edit className="w-4 h-4 mr-2" />
                          Edit Sequence
                        </Button>
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6 text-center py-12">
              <Mail className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">No sequences yet</p>
              <SequenceEditor />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
