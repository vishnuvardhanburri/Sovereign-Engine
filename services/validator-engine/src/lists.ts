import fs from 'node:fs/promises'
import path from 'node:path'
import type Redis from 'ioredis'
import { cacheKeys } from './cache'

type LoadedLists = {
  disposableDomains: Set<string>
}

let inMemory: LoadedLists | null = null

async function readLinesIfExists(filePath: string): Promise<string[] | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  } catch {
    return null
  }
}

async function loadFromVendorRefs(): Promise<Set<string> | null> {
  // In dev we have vendor_refs; in production you can instead preload redis via a job.
  const base = path.resolve(process.cwd(), 'vendor_refs')
  const d1 = path.join(base, 'disposable-email-domains', 'disposable_email_blocklist.conf')
  const d2 = path.join(base, 'mailchecker', 'list.txt')

  const [a, b] = await Promise.all([readLinesIfExists(d1), readLinesIfExists(d2)])
  if (!a && !b) return null

  const merged = new Set<string>()
  for (const line of a ?? []) merged.add(line.toLowerCase())
  for (const line of b ?? []) merged.add(line.toLowerCase())
  return merged
}

export async function loadLists(redis: Redis): Promise<LoadedLists> {
  if (inMemory) return inMemory

  const cached = await redis.get(cacheKeys.disposableDomains())
  if (cached) {
    const arr = JSON.parse(cached) as string[]
    inMemory = { disposableDomains: new Set(arr) }
    return inMemory
  }

  const merged = await loadFromVendorRefs()
  const set = merged ?? new Set<string>()

  // Persist to redis so API/workers share the same list without disk dependency.
  await redis.set(cacheKeys.disposableDomains(), JSON.stringify(Array.from(set)), 'EX', 24 * 60 * 60)

  inMemory = { disposableDomains: set }
  return inMemory
}

