import { promises as fs } from 'fs'
import path from 'path'

export interface PatternMemory {
  best_subjects: string[]
  best_intro_lines: string[]
}

const MEMORY_FILE = path.join(process.cwd(), '.xavira-pattern-memory.json')

const DEFAULT_MEMORY: PatternMemory = {
  best_subjects: [
    'Quick idea for {{company}}',
    '{{name}}, quick question',
    'Regarding {{company}} growth',
  ],
  best_intro_lines: [
    'saw your work at {{company}}',
    'noticed what you are building at {{company}}',
  ],
}

export async function loadPatternMemory(): Promise<PatternMemory> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf8')
    const parsed = JSON.parse(raw) as PatternMemory
    return {
      best_subjects: Array.isArray(parsed.best_subjects) && parsed.best_subjects.length ? parsed.best_subjects : DEFAULT_MEMORY.best_subjects,
      best_intro_lines: Array.isArray(parsed.best_intro_lines) && parsed.best_intro_lines.length ? parsed.best_intro_lines : DEFAULT_MEMORY.best_intro_lines,
    }
  } catch {
    return DEFAULT_MEMORY
  }
}

export async function updatePatternMemory(input: {
  subject?: string
  introLine?: string
  openRate?: number
  replyRate?: number
}): Promise<void> {
  const current = await loadPatternMemory()
  const next: PatternMemory = {
    best_subjects: current.best_subjects,
    best_intro_lines: current.best_intro_lines,
  }

  if (input.subject && (input.openRate ?? 0) >= 0.2) {
    next.best_subjects = [input.subject, ...next.best_subjects.filter((item) => item !== input.subject)].slice(0, 10)
  }

  if (input.introLine && (input.replyRate ?? 0) >= 0.05) {
    next.best_intro_lines = [input.introLine, ...next.best_intro_lines.filter((item) => item !== input.introLine)].slice(0, 10)
  }

  await fs.writeFile(MEMORY_FILE, JSON.stringify(next, null, 2), 'utf8')
}
