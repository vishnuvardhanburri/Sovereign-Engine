// Mock API layer with simulated data and delays

export interface Campaign {
  id: string
  name: string
  sequenceId: string
  sequenceName: string
  contactCount: number
  status: 'active' | 'paused' | 'completed'
  sent: number
  replies: number
  openRate: number
  bounceRate: number
  createdAt: Date
}

export interface Contact {
  id: string
  email: string
  name: string
  company: string
  status: 'active' | 'replied' | 'bounced'
  addedAt: Date
}

export interface Sequence {
  id: string
  name: string
  steps: SequenceStep[]
  createdAt: Date
  updatedAt: Date
}

export interface SequenceStep {
  id: string
  day: number
  subject: string
  body: string
}

export interface Reply {
  id: string
  fromEmail: string
  fromName: string
  subject: string
  date: Date
  status: 'unread' | 'interested' | 'not_interested'
  campaignId: string
  contactId: string
  messages: ReplyMessage[]
}

export interface ReplyMessage {
  id: string
  from: string
  to: string
  subject: string
  body: string
  date: Date
  isIncoming: boolean
}

export interface AnalyticsData {
  campaignName: string
  repliesCount: number
  replyRate: number
  bounceRate: number
  openRate: number
  sentCount: number
}

// Simulated delay for realistic API behavior
const delay = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms))

// Mock data generators
const generateCampaigns = (count = 8): Campaign[] => {
  const sequences = ['Outreach', 'Follow-up', 'Referral', 'Demo Request']
  const campaigns: Campaign[] = []
  
  for (let i = 1; i <= count; i++) {
    const sent = Math.floor(Math.random() * 500) + 100
    const replies = Math.floor(sent * (Math.random() * 0.15 + 0.05))
    campaigns.push({
      id: `camp_${i}`,
      name: `Campaign ${i}`,
      sequenceId: `seq_${(i % 4) + 1}`,
      sequenceName: sequences[i % 4],
      contactCount: Math.floor(Math.random() * 300) + 50,
      status: Math.random() > 0.3 ? 'active' : (Math.random() > 0.5 ? 'paused' : 'completed'),
      sent,
      replies,
      openRate: Math.floor(Math.random() * 40) + 10,
      bounceRate: Math.floor(Math.random() * 10) + 2,
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
    })
  }
  return campaigns
}

const generateContacts = (count = 15): Contact[] => {
  const companies = ['Acme Corp', 'TechStart', 'Global Industries', 'Innovation Labs', 'Digital Solutions']
  const statuses: Array<'active' | 'replied' | 'bounced'> = ['active', 'replied', 'bounced']
  const contacts: Contact[] = []
  
  for (let i = 1; i <= count; i++) {
    contacts.push({
      id: `contact_${i}`,
      email: `user${i}@example.com`,
      name: `Contact ${i}`,
      company: companies[Math.floor(Math.random() * companies.length)],
      status: statuses[Math.floor(Math.random() * statuses.length)],
      addedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
    })
  }
  return contacts
}

const generateSequences = (count = 6): Sequence[] => {
  const sequences: Sequence[] = []
  const subjectTemplates = [
    'Quick question about {{Company}}',
    'Thought of you - {{FirstName}}',
    '{{FirstName}}, following up',
    'This might help {{Company}}',
    'Last try - {{FirstName}}',
  ]
  
  for (let i = 1; i <= count; i++) {
    const steps: SequenceStep[] = []
    for (let j = 1; j <= 3; j++) {
      steps.push({
        id: `step_${i}_${j}`,
        day: j * 2,
        subject: subjectTemplates[j % subjectTemplates.length],
        body: `Hi {{FirstName}},\n\nThis is email ${j} in our sequence for {{Company}}.\n\nBest regards`,
      })
    }
    sequences.push({
      id: `seq_${i}`,
      name: `Sequence ${i}`,
      steps,
      createdAt: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - Math.random() * 15 * 24 * 60 * 60 * 1000),
    })
  }
  return sequences
}

const generateReplies = (count = 10): Reply[] => {
  const replies: Reply[] = []
  const statuses: Array<'unread' | 'interested' | 'not_interested'> = ['unread', 'interested', 'not_interested']
  
  for (let i = 1; i <= count; i++) {
    replies.push({
      id: `reply_${i}`,
      fromEmail: `prospect${i}@example.com`,
      fromName: `Prospect ${i}`,
      subject: `Re: Quick question about your company`,
      date: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      status: statuses[Math.floor(Math.random() * statuses.length)],
      campaignId: `camp_${Math.floor(Math.random() * 8) + 1}`,
      contactId: `contact_${Math.floor(Math.random() * 15) + 1}`,
      messages: [
        {
          id: 'msg_1',
          from: 'you@example.com',
          to: `prospect${i}@example.com`,
          subject: 'Quick question about your company',
          body: 'Hi there, interested in exploring a partnership?',
          date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          isIncoming: false,
        },
        {
          id: 'msg_2',
          from: `prospect${i}@example.com`,
          to: 'you@example.com',
          subject: `Re: Quick question about your company`,
          body: 'Sounds interesting! Let&apos;s chat more about this.',
          date: new Date(),
          isIncoming: true,
        },
      ],
    })
  }
  return replies
}

const generateAnalytics = (campaigns: Campaign[]): AnalyticsData[] => {
  return campaigns.slice(0, 5).map(campaign => ({
    campaignName: campaign.name,
    repliesCount: campaign.replies,
    replyRate: campaign.replies > 0 ? Math.round((campaign.replies / campaign.sent) * 100) : 0,
    bounceRate: campaign.bounceRate,
    openRate: campaign.openRate,
    sentCount: campaign.sent,
  }))
}

const generateActivityFeed = () => {
  const activities = [
    { id: 1, type: 'campaign_started', description: 'Campaign 5 started with 120 contacts', timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    { id: 2, type: 'reply_received', description: 'Reply from john@acme.com', timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000) },
    { id: 3, type: 'contacts_uploaded', description: '45 contacts uploaded from CSV', timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    { id: 4, type: 'campaign_paused', description: 'Campaign 3 paused', timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000) },
    { id: 5, type: 'reply_received', description: 'Reply from jane@startup.com', timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    { id: 6, type: 'campaign_started', description: 'Campaign 4 started with 85 contacts', timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    { id: 7, type: 'contacts_uploaded', description: '120 contacts uploaded from CSV', timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
  ]
  return activities
}

// Cached data
let cachedCampaigns = generateCampaigns()
let cachedContacts = generateContacts()
let cachedSequences = generateSequences()
let cachedReplies = generateReplies()

// API endpoints
export const api = {
  campaigns: {
    getAll: async () => {
      await delay(300)
      return cachedCampaigns
    },
    getById: async (id: string) => {
      await delay(200)
      return cachedCampaigns.find(c => c.id === id)
    },
    create: async (data: Partial<Campaign>) => {
      await delay(400)
      const newCampaign: Campaign = {
        id: `camp_${Date.now()}`,
        name: data.name || 'New Campaign',
        sequenceId: data.sequenceId || 'seq_1',
        sequenceName: data.sequenceName || 'Outreach',
        contactCount: 0,
        status: 'active',
        sent: 0,
        replies: 0,
        openRate: 0,
        bounceRate: 0,
        createdAt: new Date(),
      }
      cachedCampaigns.unshift(newCampaign)
      return newCampaign
    },
    updateStatus: async (id: string, status: 'active' | 'paused' | 'completed') => {
      await delay(300)
      const campaign = cachedCampaigns.find(c => c.id === id)
      if (campaign) {
        campaign.status = status
      }
      return campaign
    },
  },
  
  contacts: {
    getAll: async () => {
      await delay(300)
      return cachedContacts
    },
    create: async (data: Partial<Contact>) => {
      await delay(200)
      const newContact: Contact = {
        id: `contact_${Date.now()}`,
        email: data.email || '',
        name: data.name || '',
        company: data.company || '',
        status: 'active',
        addedAt: new Date(),
      }
      cachedContacts.push(newContact)
      return newContact
    },
    bulkCreate: async (data: Partial<Contact>[]) => {
      await delay(500)
      const newContacts = data.map(c => ({
        id: `contact_${Date.now()}_${Math.random()}`,
        email: c.email || '',
        name: c.name || '',
        company: c.company || '',
        status: 'active' as const,
        addedAt: new Date(),
      }))
      cachedContacts.push(...newContacts)
      return newContacts
    },
    delete: async (id: string) => {
      await delay(200)
      cachedContacts = cachedContacts.filter(c => c.id !== id)
      return { success: true }
    },
  },
  
  sequences: {
    getAll: async () => {
      await delay(300)
      return cachedSequences
    },
    getById: async (id: string) => {
      await delay(200)
      return cachedSequences.find(s => s.id === id)
    },
    create: async (data: Partial<Sequence>) => {
      await delay(400)
      const newSequence: Sequence = {
        id: `seq_${Date.now()}`,
        name: data.name || 'New Sequence',
        steps: data.steps || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      cachedSequences.push(newSequence)
      return newSequence
    },
    update: async (id: string, data: Partial<Sequence>) => {
      await delay(400)
      const sequence = cachedSequences.find(s => s.id === id)
      if (sequence) {
        sequence.name = data.name || sequence.name
        sequence.steps = data.steps || sequence.steps
        sequence.updatedAt = new Date()
      }
      return sequence
    },
  },
  
  replies: {
    getAll: async () => {
      await delay(300)
      return cachedReplies
    },
    getById: async (id: string) => {
      await delay(200)
      return cachedReplies.find(r => r.id === id)
    },
    updateStatus: async (id: string, status: 'unread' | 'interested' | 'not_interested') => {
      await delay(200)
      const reply = cachedReplies.find(r => r.id === id)
      if (reply) {
        reply.status = status
      }
      return reply
    },
  },
  
  analytics: {
    getAll: async () => {
      await delay(300)
      return generateAnalytics(cachedCampaigns)
    },
  },
  
  activity: {
    getRecent: async () => {
      await delay(200)
      return generateActivityFeed()
    },
  },
}

// Calculate dashboard stats
export const api_getStats = async () => {
  await delay(200)
  const campaigns = cachedCampaigns
  const replies = cachedReplies
  
  const totalSent = campaigns.reduce((sum, c) => sum + c.sent, 0)
  const totalReplies = replies.length
  const avgOpenRate = campaigns.length > 0 
    ? Math.round(campaigns.reduce((sum, c) => sum + c.openRate, 0) / campaigns.length)
    : 0
  const avgBounceRate = campaigns.length > 0
    ? Math.round(campaigns.reduce((sum, c) => sum + c.bounceRate, 0) / campaigns.length)
    : 0
  
  return {
    emailsSentToday: Math.floor(totalSent * 0.1), // 10% sent today
    replies: totalReplies,
    openRate: avgOpenRate,
    bounceRate: avgBounceRate,
  }
}

export const api_getChartData = async () => {
  await delay(200)
  // Last 30 days of emails sent
  const data = []
  for (let i = 30; i >= 0; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    data.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sent: Math.floor(Math.random() * 150) + 50,
    })
  }
  return data
}
