import { buildDailyOperatorReport, runDailyOperatorCycle as operatorRunDailyCycle } from '@/lib/operator'

export async function generateDailyInsight(clientId: number) {
  return buildDailyOperatorReport(clientId)
}

export async function runDailyOperatorCycle(clientId: number) {
  return operatorRunDailyCycle(clientId)
}
