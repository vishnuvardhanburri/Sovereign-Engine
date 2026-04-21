'use client'

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[UI] global error', error)
  }, [error])

  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-lg border p-6">
            <h1 className="text-lg font-semibold">Service error</h1>
            <p className="text-sm text-muted-foreground mt-2">
              The app hit an unexpected error. Retry now.
            </p>
            <button
              className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-black px-4 text-sm font-medium text-white"
              onClick={reset}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}

