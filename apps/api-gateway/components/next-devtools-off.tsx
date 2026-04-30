'use client'

import { useEffect } from 'react'

/**
 * Hides framework dev-only floating indicators.
 *
 * The dev server exposes internal endpoints to disable indicators for a cooldown period.
 * Calling them once on mount keeps demo screens clean.
 */
export function NextDevToolsOff() {
  useEffect(() => {
    // Only relevant in dev; endpoint doesn't exist in production.
    if (process.env.NODE_ENV === 'production') return
    // Try known endpoint variants so the floating dev badge stays hidden.
    fetch('/__nextjs_disable_dev_indicator', { method: 'POST' }).catch(() => {})
    fetch('/__nextjs_disable_devtools', { method: 'POST' }).catch(() => {})
    fetch('/__nextjs_disable_dev_overlay', { method: 'POST' }).catch(() => {})
  }, [])

  return null
}
