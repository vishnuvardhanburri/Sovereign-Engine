'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function AnimatedNumber(props: {
  value: number
  durationMs?: number
  format?: (value: number) => string
  className?: string
}) {
  const durationMs = props.durationMs ?? 650
  const formatter = useMemo(() => props.format ?? ((v: number) => Math.round(v).toLocaleString()), [props.format])

  const [display, setDisplay] = useState<number>(props.value)
  const rafRef = useRef<number | null>(null)
  const fromRef = useRef<number>(props.value)
  const startRef = useRef<number>(0)

  useEffect(() => {
    const from = fromRef.current
    const to = props.value
    if (!Number.isFinite(to)) return
    if (from === to) return

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    fromRef.current = display
    startRef.current = performance.now()

    const tick = (now: number) => {
      const elapsed = now - startRef.current
      const t = Math.min(1, elapsed / durationMs)
      const eased = easeOutCubic(t)
      const next = fromRef.current + (to - fromRef.current) * eased
      setDisplay(next)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value])

  return <span className={props.className}>{formatter(display)}</span>
}

