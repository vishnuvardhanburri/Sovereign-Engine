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
  const [fileName, setFileName] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { mutate: importCsv, isPending } = useImportContactsCsv()

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)

    // CSV: send raw content to server-side parser (deterministic), but tag it as manual_upload.
    if (file.name.toLowerCase().endsWith('.csv')) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = (event.target?.result as string) || ''
        setRawCsv(content)

        // Lightweight preview: first 10 lines only
        const lines = content.split(/\r?\n/).filter((l) => l.trim())
        const contacts: ParsedContact[] = []
        const seen = new Set<string>()
        lines.slice(1, 200).forEach((line) => {
          const parts = line.split(',').map((s) => s.trim())
          const email = parts.find((p) => p.includes('@')) || ''
          const name = parts[1] || ''
          const company = parts[2] || ''
          const key = email.toLowerCase()
          if (email && !seen.has(key)) {
            seen.add(key)
            contacts.push({ email, name: name || '', company: company || '' })
          }
        })
        setPreview(contacts)
      }
      reader.readAsText(file)
      return
    }

    // XLSX: parse client-side into CSV-like text (minimal, deterministic).
    if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
      try {
        const { default: XLSX } = await import('xlsx')
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const sheetName = wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })

        // Build a CSV string that backend parser can understand (headers + rows).
        const headers = Object.keys(rows[0] ?? {})
        const csvLines = [
          headers.join(','),
          ...rows.slice(0, 50_000).map((r) => headers.map((h) => String(r[h] ?? '').replaceAll('\n', ' ').replaceAll(',', ' ')).join(',')),
        ]
        const csv = csvLines.join('\n')
        setRawCsv(csv)

        const contacts: ParsedContact[] = []
        const seen = new Set<string>()
        rows.slice(0, 200).forEach((r) => {
          const email = String(r.email ?? r.Email ?? r['email_address'] ?? '').trim()
          if (!email.includes('@')) return
          const key = email.toLowerCase()
          if (seen.has(key)) return
          seen.add(key)
          contacts.push({
            email,
            name: String(r.name ?? r.Name ?? '').trim(),
            company: String(r.company ?? r.Company ?? '').trim(),
          })
        })
        setPreview(contacts)
      } catch {
        setRawCsv('')
        setPreview([])
      }
    }
  }

  const handleUpload = () => {
    if (!rawCsv.trim()) return

    importCsv({ csv: rawCsv, sourceOverride: 'manual_upload' }, {
      onSuccess: () => {
        setPreview([])
        setRawCsv('')
        setFileName('')
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
            Upload a CSV or XLSX. We will import into Manual Mode (source=manual_upload), dedupe, and optionally validate email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
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
                Preview ({preview.length} contacts){fileName ? ` • ${fileName}` : ''}
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
