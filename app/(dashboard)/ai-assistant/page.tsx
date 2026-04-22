import { GlobalStatusBar } from '@/components/ai/global-status'
import { SystemInsightPanel } from '@/components/ai/system-insight'
import { DecisionCorePanel } from '@/components/ai/decision-core'
import { QuickActionsPanel } from '@/components/ai/quick-actions'
import { ActivityStreamPanel } from '@/components/ai/activity-stream'
import { ImpactPanel } from '@/components/ai/impact-panel'

export default function AIAssistantPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Autonomous Outbound Engine</h1>
          <p className="text-muted-foreground">
            Control tower for outbound operations: real-time insight, decisions, autonomous safe execution, and impact tracking.
          </p>
        </div>
      </div>

      <GlobalStatusBar />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-4">
          <SystemInsightPanel />
        </div>
        <div className="xl:col-span-5">
          <DecisionCorePanel />
        </div>
        <div className="xl:col-span-3">
          <QuickActionsPanel />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7">
          <ActivityStreamPanel />
        </div>
        <div className="xl:col-span-5">
          <ImpactPanel />
        </div>
      </div>
    </div>
  )
}
