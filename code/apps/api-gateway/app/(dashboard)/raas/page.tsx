'use client'

import { useMemo, useState } from 'react'
import { Code2, Copy, KeyRound, ShieldCheck, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type ScoreResponse = Record<string, unknown>

export default function RaasConsolePage() {
  const [apiKey, setApiKey] = useState('')
  const [domain, setDomain] = useState('example.com')
  const [ip, setIp] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ScoreResponse | null>(null)

  const curl = useMemo(
    () => `curl -X POST http://localhost:3400/api/v1/reputation/score \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKey || 'YOUR_PUBLIC_API_KEY'}" \\
  -d '{"domain":"${domain || 'example.com'}"${ip ? `,"ip":"${ip}"` : ''}}'`,
    [apiKey, domain, ip]
  )

  async function runScore() {
    setLoading(true)
    setResult(null)
    try {
      const response = await fetch('/api/v1/reputation/score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ domain, ip: ip || undefined }),
      })
      const payload = await response.json()
      setResult(payload)
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }

  async function copyCurl() {
    await navigator.clipboard?.writeText(curl)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.18),_transparent_34%),linear-gradient(135deg,_hsl(var(--card)),_hsl(var(--background)))] p-6">
        <Badge variant="outline" className="mb-3 border-blue-500/20 bg-blue-500/10 text-blue-600">
          <ShieldCheck className="mr-1 h-3 w-3" />
          Reputation-as-a-Service
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Public RaaS Developer Console</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Turn the internal Adaptive Brain into a public health certificate API. Developers can score domains/IPs without touching the sender pipeline.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Score a Domain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Public API key</label>
              <Input type="password" placeholder="se_live_..." value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
              <p className="text-xs text-muted-foreground">
                Generate one with <code>pnpm public-api-key:create</code>. Keys are hashed in Postgres.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Domain</label>
                <Input value={domain} onChange={(event) => setDomain(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">IP address optional</label>
                <Input placeholder="1.2.3.4" value={ip} onChange={(event) => setIp(event.target.value)} />
              </div>
            </div>
            <Button onClick={runScore} disabled={loading || !apiKey.trim() || !domain.trim()} className="w-full">
              <KeyRound className="mr-2 h-4 w-4" />
              {loading ? 'Scoring...' : 'Generate Health Certificate'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Integration Snippet
              </CardTitle>
              <Button variant="outline" size="sm" onClick={copyCurl}>
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm text-slate-100">
              <code>{curl}</code>
            </pre>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <a href="/api/v1/reputation/docs" target="_blank" rel="noreferrer">
                  <Code2 className="mr-2 h-4 w-4" />
                  Public docs
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/api/v1/reputation/openapi.json" target="_blank" rel="noreferrer">
                  OpenAPI JSON
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Health Certificate Response</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[520px] overflow-auto rounded-2xl bg-muted p-4 text-sm">
            <code>{result ? JSON.stringify(result, null, 2) : 'Run a score request to view the certificate here.'}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
