import Redis from 'ioredis'
import { validatorEnv } from './config'

export function createRedis() {
  return new Redis(validatorEnv.redisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  })
}

const ns = (k: string) => `xv:validator:${k}`

export const cacheKeys = {
  mx: (domain: string) => ns(`mx:${domain}`),
  catchAll: (domain: string) => ns(`catchall:${domain}`),
  dmarc: (domain: string) => ns(`dmarc:${domain}`),
  disposableDomains: () => ns('lists:disposable:merged'),
  domainBreaker: (domain: string) => ns(`breaker:${domain}`),
  domainReputation: (domain: string) => ns(`rep:${domain}`),
  domainSmtpSlots: (domain: string) => ns(`slots:smtp:${domain}`),
  domainRate: (domain: string, minuteBucket: string) => ns(`rate:${domain}:${minuteBucket}`),
  metrics: () => ns('metrics'),
}
