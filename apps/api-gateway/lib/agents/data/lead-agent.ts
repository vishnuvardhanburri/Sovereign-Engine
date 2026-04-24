import { Contact } from '@/lib/db/types'
import { query } from '@/lib/db'
import { enrichContactProfile as enrichContactProfileIntegration } from '@/lib/integrations/enrichment'

export async function enrichContactProfile(input: {
  email: string
  name?: string | null
  companyDomain?: string | null
}) {
  return enrichContactProfileIntegration(input)
}

export async function enrichContactIfNeeded(contact: Contact) {
  if (contact.enrichment && Object.keys(contact.enrichment).length > 0) {
    return contact
  }

  const enrichment = await enrichContactProfile({
    email: contact.email,
    name: contact.name ?? undefined,
    companyDomain: contact.company_domain ?? undefined,
  })

  await query(
    `UPDATE contacts
     SET enrichment = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [enrichment.data ?? null, contact.id]
  )

  return {
    ...contact,
    enrichment: enrichment.data ?? null,
  }
}
