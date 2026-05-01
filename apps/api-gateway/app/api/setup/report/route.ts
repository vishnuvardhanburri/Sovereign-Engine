import { NextRequest, NextResponse } from 'next/server'
import { buildProductionReadinessReport, type ReadinessCheck } from '@/lib/setup-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function badge(check: ReadinessCheck) {
  const color =
    check.status === 'pass'
      ? '#047857'
      : check.status === 'fail'
        ? '#b91c1c'
        : check.status === 'warn'
          ? '#b45309'
          : '#2563eb'
  return `<span style="color:${color};font-weight:700;text-transform:uppercase">${escapeHtml(check.status)}</span>`
}

function suggestedRecord(check: ReadinessCheck) {
  const record = check.suggestedRecord
  if (!record) return ''
  return `<br><small><strong>Suggested DNS:</strong> ${escapeHtml(record.type)} ${escapeHtml(record.host)}${
    record.priority ? ` priority ${escapeHtml(record.priority)}` : ''
  } = ${escapeHtml(record.value)}${record.note ? `<br>${escapeHtml(record.note)}` : ''}</small>`
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const report = await buildProductionReadinessReport({
    domain: searchParams.get('domain'),
    smtpHost: searchParams.get('smtp_host'),
  })

  const sections = report.sections
    .map(
      (section) => `
        <section>
          <h2>${escapeHtml(section.title)}</h2>
          <p class="muted">${escapeHtml(section.summary)}</p>
          <table>
            <thead><tr><th>Status</th><th>Check</th><th>Detail</th><th>Action</th></tr></thead>
            <tbody>
              ${section.checks
                .map(
                  (check) => `
                    <tr>
                      <td>${badge(check)}</td>
                      <td>${escapeHtml(check.label)}</td>
                      <td>${escapeHtml(check.detail)}${
                        check.evidence?.length
                          ? `<br><small>${check.evidence.map(escapeHtml).join('<br>')}</small>`
                          : ''
                      }${suggestedRecord(check)}</td>
                      <td>${escapeHtml(check.action || 'No action required.')}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        </section>
      `
    )
    .join('')

  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Sovereign Engine Production Readiness Report</title>
        <style>
          body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; color: #0f172a; }
          h1 { margin-bottom: 4px; }
          h2 { margin-top: 32px; }
          .hero { border: 1px solid #dbe4ef; border-radius: 18px; padding: 24px; background: linear-gradient(135deg, #f8fafc, #ecfeff); }
          .score { font-size: 52px; font-weight: 800; letter-spacing: -0.06em; }
          .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
          .metric { border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; background: white; }
          .muted, small { color: #64748b; }
          table { border-collapse: collapse; width: 100%; overflow: hidden; border-radius: 14px; }
          th, td { border-bottom: 1px solid #e2e8f0; padding: 12px; text-align: left; vertical-align: top; }
          th { background: #f8fafc; font-size: 12px; text-transform: uppercase; color: #475569; }
          @media print { body { margin: 18px; } .hero { break-inside: avoid; } }
        </style>
      </head>
      <body>
        <div class="hero">
          <p class="muted">Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())}</p>
          <h1>Sovereign Engine Production Readiness Report</h1>
          <p class="muted">Domain: ${escapeHtml(report.domain || 'not provided')} · SMTP: ${escapeHtml(report.smtpHost || 'not configured')}</p>
          <div class="score">${report.score}/100</div>
          <div>Status: <strong>${escapeHtml(report.status)}</strong></div>
          <div class="grid">
            <div class="metric"><strong>${report.blockers}</strong><br><span class="muted">Blockers</span></div>
            <div class="metric"><strong>${report.warnings}</strong><br><span class="muted">Warnings</span></div>
            <div class="metric"><strong>${report.sections.length}</strong><br><span class="muted">Control Areas</span></div>
            <div class="metric"><strong>SHA-256</strong><br><span class="muted">Audit Chain</span></div>
          </div>
        </div>
        ${sections}
        <section>
          <h2>Next Actions</h2>
          <ol>${report.nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ol>
        </section>
      </body>
    </html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
