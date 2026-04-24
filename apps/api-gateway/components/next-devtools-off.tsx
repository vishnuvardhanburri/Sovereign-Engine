'use client'

import { useEffect } from 'react'

/**
 * Hides the Next.js DevTools floating "N" button in `next dev`.
 *
 * Next exposes an internal dev-only endpoint to disable the dev indicator for a cooldown period.
 * We call it once on mount to keep demo screens clean.
 */
export function NextDevToolsOff() {
  useEffect(() => {
    // Only relevant in dev; endpoint doesn't exist in production.
    if (process.env.NODE_ENV === 'production') return
    // Next has changed these internal endpoints across versions.
    // Try a few known variants so the floating "N" badge stays hidden in `next dev`.
    fetch('/__nextjs_disable_dev_indicator', { method: 'POST' }).catch(() => {})
    fetch('/__nextjs_disable_devtools', { method: 'POST' }).catch(() => {})
    fetch('/__nextjs_disable_dev_overlay', { method: 'POST' }).catch(() => {})
  }, [])

  return null
}
