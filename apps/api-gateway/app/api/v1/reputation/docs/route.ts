import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function html(baseUrl: string) {
  const endpoint = `${baseUrl}/api/v1/reputation/score`
  const openApiUrl = `${baseUrl}/api/v1/reputation/openapi.json`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Xavira Reputation Shield API</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #09110f; color: #ecfdf5; }
      main { max-width: 980px; margin: 0 auto; padding: 48px 22px 72px; }
      .hero { border: 1px solid rgba(16,185,129,.35); border-radius: 28px; padding: 34px; background: radial-gradient(circle at 20% 10%, rgba(16,185,129,.24), transparent 35%), linear-gradient(145deg, rgba(15,23,42,.86), rgba(6,78,59,.46)); box-shadow: 0 30px 90px rgba(0,0,0,.38); }
      h1 { margin: 0 0 12px; font-size: clamp(34px, 6vw, 64px); line-height: .95; letter-spacing: -.06em; }
      h2 { margin-top: 38px; color: #a7f3d0; }
      p { color: #cbd5e1; line-height: 1.7; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      pre { overflow-x: auto; background: rgba(2,6,23,.82); border: 1px solid rgba(148,163,184,.24); border-radius: 18px; padding: 18px; color: #d1fae5; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; margin-top: 20px; }
      .card { border: 1px solid rgba(148,163,184,.2); border-radius: 18px; padding: 18px; background: rgba(15,23,42,.72); }
      a { color: #5eead4; }
      .pill { display: inline-flex; padding: 7px 11px; border: 1px solid rgba(94,234,212,.35); border-radius: 999px; color: #99f6e4; background: rgba(20,184,166,.08); font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <span class="pill">Reputation-as-a-Service v1</span>
        <h1>Xavira Reputation Shield API</h1>
        <p>Generate a public Health Certificate for any domain or IP using Xavira Orbit's Adaptive Brain, provider lane cache, DNS light scan, and blacklist checks.</p>
      </section>

      <h2>Endpoint</h2>
      <pre>POST ${endpoint}
Authorization: Bearer xvra_live_...
Content-Type: application/json

{
  "domain": "example.com",
  "ip": "1.2.3.4"
}</pre>

      <h2>Quick cURL</h2>
      <pre>curl -X POST "${endpoint}" \\
  -H "x-api-key: $XAVIRA_REPUTATION_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"domain":"example.com","ip":"1.2.3.4"}'</pre>

      <h2>Response Includes</h2>
      <div class="grid">
        <div class="card"><strong>reputation_score</strong><p>0-100 score from internal reputation state or DNS shadow scan.</p></div>
        <div class="card"><strong>provider_status</strong><p>Gmail, Outlook, and Yahoo risk levels with source attribution.</p></div>
        <div class="card"><strong>blacklist_status</strong><p>Spamhaus DBL/ZEN and URIBL DNSBL checks, cached for speed.</p></div>
        <div class="card"><strong>billing</strong><p>Tier, daily usage, billable units, and reset timestamp.</p></div>
      </div>

      <h2>OpenAPI</h2>
      <p>Machine-readable docs are available at <a href="${openApiUrl}">${openApiUrl}</a>.</p>
    </main>
  </body>
</html>`
}

export async function GET(_request: NextRequest) {
  return new NextResponse(html(appEnv.appBaseUrl()), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
