import { readFileSync } from 'node:fs'

export function loadBackendAgentPrompt(): string {
  return readFileSync(new URL('../../backend-agent-prompt.txt', import.meta.url), 'utf8')
}
