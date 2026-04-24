import 'dotenv/config'
import { hashPassword } from '@/lib/auth/password'
import { assignUserToClient, upsertUser } from '@/lib/authz'
import { appEnv } from '@/lib/env'

async function main(): Promise<void> {
  const email = String(process.argv[2] ?? '').trim().toLowerCase()
  const password = String(process.argv[3] ?? '')

  if (!email || !password) {
    console.error('Usage: pnpm tsx scripts/create-user.ts <email> <password>')
    process.exit(1)
  }

  const user = await upsertUser({
    email,
    name: email.split('@')[0] ?? null,
    passwordHash: hashPassword(password),
  })
  if (!user) {
    throw new Error('Failed to upsert user')
  }

  const clientId = appEnv.defaultClientId()
  await assignUserToClient({ clientId, userId: user.id, role: 'owner' })

  console.log(`Created/updated user: ${email} (client_id=${clientId})`)
}

main().catch((err) => {
  console.error('Failed to create user', err)
  process.exit(1)
})
