export interface MetricsCounters {
  sends: number
  failures: number
  replies: number
  domainHealthChecks: number
}

const counters: MetricsCounters = {
  sends: 0,
  failures: 0,
  replies: 0,
  domainHealthChecks: 0,
}

export const metrics = {
  recordSend: () => {
    counters.sends += 1
  },
  recordFailure: () => {
    counters.failures += 1
  },
  recordReply: () => {
    counters.replies += 1
  },
  recordDomainHealthCheck: () => {
    counters.domainHealthChecks += 1
  },
  snapshot: (): MetricsCounters => ({ ...counters }),
}
