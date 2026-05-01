import { NextRequest, NextResponse } from 'next/server'
import { importContacts, parseContactsCsv } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { recordAuditLog } from '@/lib/security/audit-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SAMPLE_CSV = `email,name,company,title,timezone,company_domain,source
ava.chen@northstar.example,Ava Chen,Northstar Robotics,VP Revenue,America/New_York,northstar.example,buyer_demo
marco.silva@bluefin.example,Marco Silva,Bluefin Analytics,Head of Growth,Europe/Lisbon,bluefin.example,buyer_demo
priya.rao@cobalt.example,Priya Rao,Cobalt Cloud,Founder,Asia/Kolkata,cobalt.example,buyer_demo
elena.morris@atlas.example,Elena Morris,Atlas Ops,RevOps Director,Europe/London,atlas.example,buyer_demo
noah.kim@signalforge.example,Noah Kim,SignalForge,CEO,America/Los_Angeles,signalforge.example,buyer_demo`

function previewPayload() {
  const contacts = parseContactsCsv(SAMPLE_CSV, { sourceOverride: 'demo_sample_csv' })
  return {
    ok: true,
    csv: SAMPLE_CSV,
    contacts,
    stats: {
      totalRows: contacts.length,
      validFormat: contacts.filter((contact) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)).length,
      companies: new Set(contacts.map((contact) => contact.company).filter(Boolean)).size,
      mode: 'safe-demo',
    },
  }
}

export async function GET() {
  return NextResponse.json(previewPayload())
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const clientId = await resolveClientId({ body, headers: request.headers })
  const contacts = parseContactsCsv(typeof body?.csv === 'string' ? body.csv : SAMPLE_CSV, {
    sourceOverride: 'demo_sample_csv',
  })

  const imported = await importContacts(clientId, {
    contacts,
    verify: false,
    enrich: false,
    dedupeByDomain: false,
  })

  await recordAuditLog({
    request,
    clientId,
    actionType: 'demo_contacts_imported',
    resourceType: 'contacts',
    resourceId: `client:${clientId}`,
    details: { imported: imported.length, source: 'demo_sample_csv' },
  })

  return NextResponse.json({
    ok: true,
    imported: imported.length,
    contacts: imported,
  })
}
