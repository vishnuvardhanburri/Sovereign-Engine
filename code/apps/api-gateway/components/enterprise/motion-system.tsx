'use client'

import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/utils'

export const enterpriseSpring = {
  type: 'spring',
  stiffness: 260,
  damping: 28,
  mass: 0.8,
} as const

export const enterpriseEase = [0.22, 1, 0.36, 1] as const

export function MotionPanel({
  className,
  children,
  delay = 0,
  ...props
}: HTMLMotionProps<'div'> & { delay?: number }) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? { duration: 0 } : { ...enterpriseSpring, delay }}
      className={cn('rounded-3xl border border-white/10 bg-card/80 shadow-[0_24px_80px_rgba(0,0,0,0.26)]', className)}
      {...props}
    >
      {children}
    </motion.div>
  )
}

export function StatusPulse({ tone = 'emerald' }: { tone?: 'emerald' | 'amber' | 'rose' | 'sky' }) {
  const reduceMotion = useReducedMotion()
  const toneClass = {
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    sky: 'bg-sky-400',
  }[tone]

  return (
    <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center">
      {!reduceMotion ? <span className={cn('absolute h-2.5 w-2.5 rounded-full opacity-35 motion-safe:animate-ping', toneClass)} /> : null}
      <span className={cn('relative h-2.5 w-2.5 rounded-full', toneClass)} />
    </span>
  )
}

export function QueueFlow({ pressure }: { pressure: number }) {
  const reduceMotion = useReducedMotion()
  const width = Math.max(6, Math.min(100, pressure))
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-slate-800">
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300"
        initial={false}
        animate={{ width: `${width}%` }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.65, ease: enterpriseEase }}
      />
      {!reduceMotion ? (
        <motion.div
          className="absolute inset-y-0 w-16 rounded-full bg-white/30 blur-sm"
          animate={{ x: ['-20%', '720%'] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'linear' }}
        />
      ) : null}
    </div>
  )
}
