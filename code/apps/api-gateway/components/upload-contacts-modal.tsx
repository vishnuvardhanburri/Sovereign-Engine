'use client'

import { useMemo, useRef, useState } from 'react'
import { useImportContactsFile, useImportContactsPreview } from '@/lib/hooks'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type PreviewPayload = {
  detectedColumns: string[]
  sampleRows: Array<Record<string, unknown>>
  stats: { totalRows: number; validEmails: number; invalidEmails: number; duplicateEmails: number }
  suggestedMapping: Record<string, string> | null
}

export function UploadContactsModal() {
  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})

  const fileInputRef = useRef<HTMLInputElement>(null)
  const { mutateAsync: previewImport, isPending: previewing } = useImportContactsPreview()
  const { mutate: importFile, isPending: importing } = useImportContactsFile()

  const columns = useMemo(() => preview?.detectedColumns ?? [], [preview])
  const emailOk = Boolean(mapping.email && mapping.email.trim())

  const reset = () => {
    setPreview(null)
    setMapping({})
    setFileName('')
    setFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0]
    if (!next) return

    setFileName(next.name)
    setFile(next)
    const result = (await previewImport(next)) as any
    setPreview(result)
    setMapping({ ...(result?.suggestedMapping ?? {}) })
  }

  const handleUpload = () => {
    if (!file || !preview || !emailOk) return

    importFile(
      { file, mapping, verify: true },
      {
        onSuccess: () => {
          reset()
          setOpen(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next)
      if (!next) reset()
    }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="w-4 h-4 mr-2" />
          Upload Contacts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Contacts (Manual Mode)</DialogTitle>
          <DialogDescription>
            Upload a CSV or XLSX. We preview first, allow column mapping, then import into Manual Mode (`source=manual_upload`). No enrichment or auto expansion.
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
              id="contacts-file"
              disabled={previewing || importing}
            />
            <label htmlFor="contacts-file" className="cursor-pointer flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-muted-foreground" />
              <span className="text-sm font-medium">Click to select CSV/XLSX file</span>
              <span className="text-xs text-muted-foreground">{fileName ? fileName : 'or drag and drop'}</span>
            </label>
          </div>

          {preview && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium">Preview{fileName ? ` • ${fileName}` : ''}</p>
                <div className="text-xs text-muted-foreground">
                  {preview.stats.totalRows} rows · {preview.stats.validEmails} valid · {preview.stats.invalidEmails} invalid · {preview.stats.duplicateEmails} duplicates
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-medium">Email (required)</div>
                  <Select value={mapping.email ?? ''} onValueChange={(v) => setMapping((m) => ({ ...m, email: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium">Company</div>
                  <Select value={mapping.company ?? ''} onValueChange={(v) => setMapping((m) => ({ ...m, company: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium">Name</div>
                  <Select value={mapping.name ?? ''} onValueChange={(v) => setMapping((m) => ({ ...m, name: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium">Title</div>
                  <Select value={mapping.title ?? ''} onValueChange={(v) => setMapping((m) => ({ ...m, title: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto border rounded-lg p-3">
                <div className="space-y-1 text-xs">
                  {preview.sampleRows.slice(0, 10).map((row, idx) => {
                    const email = mapping.email ? String((row as any)[mapping.email] ?? '') : ''
                    const company = mapping.company ? String((row as any)[mapping.company] ?? '') : ''
                    return (
                      <div key={idx} className="flex justify-between gap-4 pb-1 border-b last:border-0">
                        <span className="text-muted-foreground truncate">{email || '(no email)'}</span>
                        <span className="text-muted-foreground truncate">{company}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => { setOpen(false); reset() }} disabled={previewing || importing}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!preview || !emailOk || previewing || importing} className="gap-2">
              {(previewing || importing) && <Spinner className="w-4 h-4" />}
              Import Prospects
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

