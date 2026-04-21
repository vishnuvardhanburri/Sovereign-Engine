'use client'

import { useState, useRef } from 'react'
import { useImportContactsCsv } from '@/lib/hooks'
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
import { Spinner } from '@/components/ui/spinner'
import { Upload } from 'lucide-react'

interface ParsedContact {
  email: string
  name: string
  company: string
}

export function UploadContactsModal() {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<ParsedContact[]>([])
  const [rawCsv, setRawCsv] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { mutate: importCsv, isPending } = useImportContactsCsv()

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setRawCsv(content)
      const lines = content.split('\n').filter((l) => l.trim())

      const contacts: ParsedContact[] = []
      const seen = new Set<string>()

      lines.slice(1).forEach((line) => {
        const parts = line.split(',').map((s) => s.trim())
        const email = parts.find((p) => p.includes('@')) || ''
        const name = parts[1] || ''
        const company = parts[2] || ''
        const key = email.toLowerCase()
        if (email && !seen.has(key)) {
          seen.add(key)
          contacts.push({
            email,
            name: name || '',
            company: company || '',
          })
        }
      })

      setPreview(contacts)
    }
    reader.readAsText(file)
  }

  const handleUpload = () => {
    if (!rawCsv.trim()) return

    importCsv({ csv: rawCsv }, {
      onSuccess: () => {
        setPreview([])
        setRawCsv('')
        setOpen(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="w-4 h-4 mr-2" />
          Upload CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV file. We will automatically detect columns like email, name, company, title, and timezone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              id="csv-file"
            />
            <label
              htmlFor="csv-file"
              className="cursor-pointer flex flex-col items-center gap-2"
            >
              <Upload className="w-8 h-8 text-muted-foreground" />
              <span className="text-sm font-medium">
                Click to select CSV file
              </span>
              <span className="text-xs text-muted-foreground">
                or drag and drop
              </span>
            </label>
          </div>

          {preview.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Preview ({preview.length} contacts)
              </p>
              <div className="max-h-48 overflow-y-auto border rounded-lg p-3">
                <div className="space-y-1 text-xs">
                  {preview.slice(0, 10).map((contact, i) => (
                    <div key={i} className="flex gap-2 pb-1 border-b last:border-0">
                      <span className="text-muted-foreground min-w-fit">
                        {contact.email}
                      </span>
                      <span className="text-muted-foreground">
                        {contact.name} ({contact.company})
                      </span>
                    </div>
                  ))}
                  {preview.length > 10 && (
                    <p className="text-muted-foreground pt-2">
                      +{preview.length - 10} more...
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false)
                setPreview([])
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={isPending || !rawCsv.trim()}
              className="gap-2"
            >
              {isPending && <Spinner className="w-4 h-4" />}
              Import Prospects
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
