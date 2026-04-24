/**
 * Xavira AI Assistant
 * Conversational AI assistant for cold email platform management
 * Deterministic only, no external model dependencies.
 */

export interface XaviraAIRequest {
  message: string
  userId?: string
  context?: {
    currentCampaign?: string
    currentContacts?: string[]
    userRole?: string
    recentActions?: string[]
  }
  task?: 'campaign_management' | 'contact_analysis' | 'content_generation' | 'spam_detection' | 'reply_analysis' | 'scraping' | 'general'
}

export interface XaviraAIResponse {
  response: string
  actions: XaviraAIAction[]
  confidence: number
  suggestedCommands?: string[]
  metadata: {
    model: string
    tokensUsed: number
    cost: number
    processingTime: number
  }
}

export interface XaviraAIAction {
  type: 'create_campaign' | 'update_contacts' | 'generate_content' | 'analyze_performance' | 'scrape_contacts' | 'send_emails' | 'get_analytics'
  data: Record<string, any>
  priority: 'high' | 'medium' | 'low'
  description: string
}

export class XaviraAIAssistant {
  private conversationHistory: Map<string, Array<{role: 'user' | 'assistant', content: string, timestamp: Date}>> = new Map()

  constructor() {
    // Deterministic assistant, no external dependencies.
  }

  /**
   * Process a natural language request and return intelligent response with actions
   */
  async processRequest(request: XaviraAIRequest): Promise<XaviraAIResponse> {
    const startTime = Date.now()
    const userId = request.userId || 'anonymous'

    // Add to conversation history
    this.addToHistory(userId, 'user', request.message)

    try {
      // Analyze the intent and extract actionable commands
      const intent = await this.analyzeIntent(request.message, request.context)

      // Generate response based on intent
      const response = await this.generateResponse(intent, request)

      // Extract specific actions from the request
      const actions = await this.extractActions(request.message, intent, request.context)

      // Calculate confidence and metadata
      const confidence = this.calculateConfidence(intent, actions)
      const processingTime = Date.now() - startTime

      const aiResponse: XaviraAIResponse = {
        response,
        actions,
        confidence,
        suggestedCommands: this.getSuggestedCommands(intent),
        metadata: {
          model: 'xavira-ai-assistant',
          tokensUsed: Math.floor(request.message.length / 4), // Rough estimate
          cost: 0.001, // Minimal cost for assistant processing
          processingTime
        }
      }

      // Add assistant response to history
      this.addToHistory(userId, 'assistant', response)

      return aiResponse

    } catch (error) {
      console.error('Xavira AI processing error:', error)
      return {
        response: "I apologize, but I encountered an error processing your request. Please try rephrasing or contact support if the issue persists.",
        actions: [],
        confidence: 0,
        metadata: {
          model: 'xavira-ai-assistant',
          tokensUsed: 0,
          cost: 0,
          processingTime: Date.now() - startTime
        }
      }
    }
  }

  /**
   * Analyze the intent behind the user's message
   */
  private async analyzeIntent(message: string, context?: XaviraAIRequest['context']): Promise<string> {
    const lowerMessage = message.toLowerCase()
    if (lowerMessage.includes('campaign') || lowerMessage.includes('create') || lowerMessage.includes('send')) {
      return 'campaign_management'
    }
    if (lowerMessage.includes('contact') || lowerMessage.includes('list') || lowerMessage.includes('segment')) {
      return 'contact_analysis'
    }
    if (lowerMessage.includes('content') || lowerMessage.includes('write') || lowerMessage.includes('copy')) {
      return 'content_generation'
    }
    if (lowerMessage.includes('spam') || lowerMessage.includes('check') || lowerMessage.includes('compliance')) {
      return 'spam_detection'
    }
    if (lowerMessage.includes('reply') || lowerMessage.includes('response') || lowerMessage.includes('analyze')) {
      return 'reply_analysis'
    }
    if (lowerMessage.includes('scrape') || lowerMessage.includes('find') || lowerMessage.includes('extract')) {
      return 'scraping'
    }
    if (lowerMessage.includes('report') || lowerMessage.includes('analytics') || lowerMessage.includes('performance')) {
      return 'analytics'
    }
    return 'general'
  }

  /**
   * Generate a natural language response based on intent
   */
  private async generateResponse(intent: string, request: XaviraAIRequest): Promise<string> {
    const contextPrompt = request.context ? `
Current context:
- Campaign: ${request.context.currentCampaign || 'None'}
- Contacts: ${request.context.currentContacts?.length || 0} selected
- Recent actions: ${request.context.recentActions?.join(', ') || 'None'}
` : ''

    switch (intent) {
      case 'campaign_management':
        return "I can help manage campaigns. Create, edit, or review performance."
      case 'contact_analysis':
        return "I can help segment contacts and analyze engagement."
      case 'content_generation':
        return "I can help with subject lines, email copy, and follow-ups."
      case 'spam_detection':
        return "I can review content for spam risks and compliance issues."
      case 'scraping':
        return "I can help extract contact details from approved sources."
      case 'analytics':
        return "I can summarize performance, reply trends, and open rates."
      default:
        return "I can help with campaign management, contact analysis, content, scraping, and analytics."
    }
  }

  /**
   * Extract specific actions that can be taken based on the request
   */
  private async extractActions(message: string, intent: string, context?: XaviraAIRequest['context']): Promise<XaviraAIAction[]> {
    const actions: XaviraAIAction[] = []

    // Extract campaign creation
    if (intent === 'campaign_management' && message.toLowerCase().includes('create')) {
      const campaignName = this.extractCampaignName(message)
      if (campaignName) {
        actions.push({
          type: 'create_campaign',
          data: { name: campaignName, type: 'cold_outreach' },
          priority: 'high',
          description: `Create new campaign: ${campaignName}`
        })
      }
    }

    // Extract contact analysis
    if (intent === 'contact_analysis') {
      actions.push({
        type: 'analyze_performance',
        data: { contacts: context?.currentContacts || [], analysisType: 'engagement' },
        priority: 'medium',
        description: 'Analyze contact engagement and segmentation'
      })
    }

    // Extract content generation
    if (intent === 'content_generation') {
      const contentType = this.extractContentType(message)
      actions.push({
        type: 'generate_content',
        data: {
          type: contentType,
          campaign: context?.currentCampaign,
          targetAudience: 'general'
        },
        priority: 'high',
        description: `Generate ${contentType} content`
      })
    }

    // Extract scraping requests
    if (intent === 'scraping') {
      const urls = this.extractUrls(message)
      if (urls.length > 0) {
        actions.push({
          type: 'scrape_contacts',
          data: { urls, category: 'business' },
          priority: 'medium',
          description: `Scrape contact data from ${urls.length} URLs`
        })
      }
    }

    return actions
  }

  /**
   * Calculate confidence score for the response
   */
  private calculateConfidence(intent: string, actions: XaviraAIAction[]): number {
    let confidence = 0.5 // Base confidence

    // Higher confidence for clear intents with actions
    if (actions.length > 0) confidence += 0.3
    if (intent !== 'general') confidence += 0.2

    // Lower confidence for complex or unclear requests
    if (actions.length === 0 && intent === 'general') confidence -= 0.2

    return Math.max(0.1, Math.min(1.0, confidence))
  }

  /**
   * Get suggested commands based on intent
   */
  private getSuggestedCommands(intent: string): string[] {
    switch (intent) {
      case 'campaign_management':
        return [
          "Create a new campaign for tech startups",
          "Show me my active campaigns",
          "Edit campaign settings"
        ]
      case 'contact_analysis':
        return [
          "Segment contacts by industry",
          "Find best performing contacts",
          "Analyze contact engagement"
        ]
      case 'content_generation':
        return [
          "Write a subject line for SaaS product",
          "Create personalized email copy",
          "Generate follow-up sequence"
        ]
      case 'scraping':
        return [
          "Scrape contacts from linkedin.com/company/example",
          "Extract emails from website",
          "Find social profiles for contacts"
        ]
      case 'analytics':
        return [
          "Show campaign performance",
          "Get reply analysis report",
          "Display open rate trends"
        ]
      default:
        return [
          "Help me create a campaign",
          "Analyze my contacts",
          "Generate email content"
        ]
    }
  }

  /**
   * Helper methods for extracting information from messages
   */
  private extractCampaignName(message: string): string | null {
    const patterns = [
      /create (?:a |an )?campaign (?:called |named )?["']?([^"'\n]+)["']?/i,
      /new campaign:? ?["']?([^"'\n]+)["']?/i,
      /campaign (?:called |named )?["']?([^"'\n]+)["']?/i
    ]

    for (const pattern of patterns) {
      const match = message.match(pattern)
      if (match && match[1]) {
        return match[1].trim()
      }
    }
    return null
  }

  private extractContentType(message: string): string {
    const lowerMessage = message.toLowerCase()
    if (lowerMessage.includes('subject')) return 'subject_line'
    if (lowerMessage.includes('copy') || lowerMessage.includes('email')) return 'email_copy'
    if (lowerMessage.includes('sequence') || lowerMessage.includes('follow')) return 'sequence'
    return 'email_copy'
  }

  private extractUrls(message: string): string[] {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    const matches = message.match(urlRegex)
    return matches || []
  }

  /**
   * Manage conversation history
   */
  private addToHistory(userId: string, role: 'user' | 'assistant', content: string): void {
    if (!this.conversationHistory.has(userId)) {
      this.conversationHistory.set(userId, [])
    }

    const history = this.conversationHistory.get(userId)!
    history.push({ role, content, timestamp: new Date() })

    // Keep only last 20 messages
    if (history.length > 20) {
      history.splice(0, history.length - 20)
    }
  }

  /**
   * Get conversation history for context
   */
  getConversationHistory(userId: string): Array<{role: string, content: string, timestamp: Date}> {
    return this.conversationHistory.get(userId) || []
  }

  /**
   * Clear conversation history
   */
  clearHistory(userId: string): void {
    this.conversationHistory.delete(userId)
  }
}

// Singleton instance
let xaviraAIInstance: XaviraAIAssistant | null = null

export function getXaviraAI(): XaviraAIAssistant {
  if (!xaviraAIInstance) {
    xaviraAIInstance = new XaviraAIAssistant()
  }
  return xaviraAIInstance
}

export async function processXaviraAIRequest(request: XaviraAIRequest): Promise<XaviraAIResponse> {
  const ai = getXaviraAI()
  return ai.processRequest(request)
}

// Convenience functions for common tasks
export async function createCampaignWithAI(name: string, description?: string): Promise<XaviraAIResponse> {
  return processXaviraAIRequest({
    message: `Create a new campaign called "${name}"${description ? ` with description: ${description}` : ''}`,
    task: 'campaign_management'
  })
}

export async function generateContentWithAI(type: string, context: string): Promise<XaviraAIResponse> {
  return processXaviraAIRequest({
    message: `Generate ${type} content for: ${context}`,
    task: 'content_generation'
  })
}

export async function analyzeContactsWithAI(contactIds: string[]): Promise<XaviraAIResponse> {
  return processXaviraAIRequest({
    message: `Analyze these contacts for cold email potential: ${contactIds.join(', ')}`,
    context: { currentContacts: contactIds },
    task: 'contact_analysis'
  })
}
