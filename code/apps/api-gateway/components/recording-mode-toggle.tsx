'use client'

import { useEffect, useState } from 'react'
import { Video } from 'lucide-react'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'sovereign-engine-recording-mode'

function applyRecordingMode(enabled: boolean) {
  document.documentElement.dataset.recordingMode = enabled ? 'true' : 'false'
}

export function RecordingModeToggle() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) === 'true'
    setEnabled(stored)
    applyRecordingMode(stored)
  }, [])

  function toggle() {
    const next = !enabled
    setEnabled(next)
    window.localStorage.setItem(STORAGE_KEY, String(next))
    applyRecordingMode(next)
  }

  return (
    <Button
      variant={enabled ? 'default' : 'outline'}
      size="sm"
      className="gap-2"
      onClick={toggle}
      title="Clean up the UI for screen recordings"
    >
      <Video className="h-4 w-4" />
      <span className="hidden lg:inline">{enabled ? 'Recording On' : 'Recording'}</span>
    </Button>
  )
}
