'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, FileSpreadsheet, Upload, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type DemoImportResponse = {
  ok: boolean
  csv: string
  contacts: Array<{ email: string; name?: string; company?: string; title?: string }>
  stats: {
    totalRows: number
    validFormat: number
    companies: number
    mode: string
  }
}

async function fetchDemoImport(): Promise<DemoImportResponse> {
  const response = await fetch('/api/contacts/demo-import', { cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to load sample CSV')
  return response.json()
}

export default function DemoImportPage() {
  const sample = useQuery({ queryKey: ['demo-import'], queryFn: fetchDemoImport })
  const [result, setResult] = useState<string>('')
  const [loading, setLoading] = useState(false)

  async function importSample() {
    setLoading(true)
    setResult('')
    try {
      const response = await fetch('/api/contacts/demo-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: sample.data?.csv }),
      })
      const payload = await response.json()
      setResult(payload.ok ? `Imported ${payload.imported} safe demo prospects.` : payload.error || 'Import failed.')
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.18),_transparent_32%),linear-gradient(135deg,_hsl(var(--card)),_hsl(var(--background)))] p-6">
        <Badge variant="outline" className="mb-3 border-amber-500/20 bg-amber-500/10 text-amber-600">
          <FileSpreadsheet className="mr-1 h-3 w-3" />
          Safe CSV demo
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Demo Import Flow</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Show a buyer the contact ingestion path without using real recipient data. These example addresses use reserved demo domains.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="text-2xl font-semibold">{sample.data?.stats.totalRows ?? 0}</div>
            <div className="text-sm text-muted-foreground">Rows in sample</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-2xl font-semibold">{sample.data?.stats.validFormat ?? 0}</div>
            <div className="text-sm text-muted-foreground">Valid email formats</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-2xl font-semibold">{sample.data?.stats.companies ?? 0}</div>
            <div className="text-sm text-muted-foreground">Unique companies</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle>Sample Prospects</CardTitle>
            <div className="flex gap-2">
              <Button onClick={importSample} disabled={loading || !sample.data}>
                <Upload className="mr-2 h-4 w-4" />
                {loading ? 'Importing...' : 'Import demo prospects'}
              </Button>
              <Button variant="outline" asChild>
                <Link href="/contacts">
                  <Users className="mr-2 h-4 w-4" />
                  Open prospects
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {result}
            </div>
          ) : null}
          <div className="overflow-hidden rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">Title</th>
                </tr>
              </thead>
              <tbody>
                {(sample.data?.contacts ?? []).map((contact) => (
                  <tr key={contact.email} className="border-t">
                    <td className="px-4 py-3">{contact.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{contact.email}</td>
                    <td className="px-4 py-3">{contact.company}</td>
                    <td className="px-4 py-3 text-muted-foreground">{contact.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
