import { QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function createPrefetchUtils(queryClient: QueryClient) {
  return {
    prefetchDashboard: async () => {
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: ['dashboard', 'stats'],
          queryFn: () => api.dashboard.getStats(),
        }),
        queryClient.prefetchQuery({
          queryKey: ['dashboard', 'chart'],
          queryFn: () => api.dashboard.getChartData(),
        }),
        queryClient.prefetchQuery({
          queryKey: ['dashboard', 'activities'],
          queryFn: () => api.dashboard.getActivityFeed(),
        }),
      ])
    },

    prefetchCampaigns: async () => {
      await queryClient.prefetchQuery({
        queryKey: ['campaigns'],
        queryFn: () => api.campaigns.getAll(),
      })
    },

    prefetchContacts: async () => {
      await queryClient.prefetchQuery({
        queryKey: ['contacts'],
        queryFn: () => api.contacts.getAll(),
      })
    },

    prefetchSequences: async () => {
      await queryClient.prefetchQuery({
        queryKey: ['sequences'],
        queryFn: () => api.sequences.getAll(),
      })
    },

    prefetchAnalytics: async () => {
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: ['analytics', 'summary'],
          queryFn: () => api.analytics.getSummary(),
        }),
        queryClient.prefetchQuery({
          queryKey: ['analytics', 'chart'],
          queryFn: () => api.analytics.getChartData(),
        }),
      ])
    },

    prefetchInbox: async () => {
      await queryClient.prefetchQuery({
        queryKey: ['inbox'],
        queryFn: () => api.inbox.getReplies(),
      })
    },

    prefetchDomains: async () => {
      await queryClient.prefetchQuery({
        queryKey: ['domains'],
        queryFn: () => api.domains.getAll(),
      })
    },
  }
}

export type PrefetchUtils = ReturnType<typeof createPrefetchUtils>
