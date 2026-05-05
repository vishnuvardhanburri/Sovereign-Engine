import { DomainManager } from '@/components/domain-manager'
import { AddDomainModal } from '@/components/add-domain-modal'

export default function DomainsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Domains</h1>
          <p className="text-muted-foreground">
            Manage your sending domains and email identities
          </p>
        </div>
        <AddDomainModal />
      </div>

      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
          Domain Health & Rate Control
        </h3>
        <p className="text-sm text-blue-800 dark:text-blue-200">
          Each domain&apos;s health score is calculated based on bounce and reply rates.
          Domains with bounce rates &gt; 5% are automatically paused. Limits scale from 50
          to 500 emails/day based on health metrics.
        </p>
      </div>

      <DomainManager />
    </div>
  )
}
