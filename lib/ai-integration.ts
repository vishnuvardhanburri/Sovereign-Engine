// @ts-nocheck
/**
 * AI/LLM Integration Engine with Web Scraping
 * Centralized AI management with cost controls, optimization, and web scraping
 * Supports OpenRouter API with model preferences, token limits, and contact data scraping
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import puppeteer, { Browser, Page } from 'puppeteer'

// Model configurations with cost tiers
export interface AIModel {
  id: string
  name: string
  provider: string
  costPerToken: number // USD per 1K tokens
  maxTokens: number
  capabilities: string[]
  priority: number // Higher = preferred
}

export interface AIRequest {
  prompt: string
  model?: string
  maxTokens?: number
  temperature?: number
  task: 'spam_detection' | 'reply_analysis' | 'personalization' | 'content_generation'
  context?: Record<string, any>
}

export interface AIResponse {
  success: boolean
  content: string
  model: string
  tokensUsed: number
  cost: number
  cached: boolean
  error?: string
}

export interface ScrapedContactData {
  emails: string[]
  phoneNumbers: string[]
  addresses: string[]
  socialProfiles: {
    linkedin?: string
    twitter?: string
    facebook?: string
    instagram?: string
    github?: string
  }
  jobTitle?: string
  company?: string
  website?: string
  bio?: string
  location?: string
  industry?: string
  companySize?: string
  revenue?: string
  technologies?: string[]
  confidence: number
  source: string
  scrapedAt: Date
}

export interface ScrapingRequest {
  url: string
  type: 'company' | 'person' | 'contact_page' | 'linkedin' | 'general'
  selectors?: Record<string, string> // Custom CSS selectors
  maxDepth?: number // For crawling
  antiDetection?: boolean
}

export interface ScrapingResult {
  success: boolean
  data?: ScrapedContactData
  error?: string
  requestCount: number
  duration: number
}

// Default model configurations (cost-effective tier)
const DEFAULT_MODELS: AIModel[] = [
  {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'Anthropic',
    costPerToken: 0.00025, // $0.25 per 1M tokens
    maxTokens: 200000,
    capabilities: ['text', 'analysis', 'classification'],
    priority: 10
  },
  {
    id: 'anthropic/claude-3-sonnet',
    name: 'Claude 3 Sonnet',
    provider: 'Anthropic',
    costPerToken: 0.0015, // $1.50 per 1M tokens
    maxTokens: 200000,
    capabilities: ['text', 'analysis', 'generation', 'personalization'],
    priority: 8
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    costPerToken: 0.00015, // $0.15 per 1M tokens
    maxTokens: 128000,
    capabilities: ['text', 'analysis', 'generation'],
    priority: 9
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    costPerToken: 0.0025, // $2.50 per 1M tokens
    maxTokens: 128000,
    capabilities: ['text', 'analysis', 'generation', 'personalization', 'complex_reasoning'],
    priority: 7
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B',
    provider: 'Meta',
    costPerToken: 0.00005, // $0.05 per 1M tokens
    maxTokens: 128000,
    capabilities: ['text', 'analysis', 'classification'],
    priority: 6
  }
]

// Task-specific model preferences (cost-optimized)
const TASK_MODEL_PREFERENCES: Record<string, string[]> = {
  spam_detection: ['meta-llama/llama-3.1-8b-instruct', 'anthropic/claude-3-haiku', 'openai/gpt-4o-mini'],
  reply_analysis: ['anthropic/claude-3-haiku', 'openai/gpt-4o-mini', 'anthropic/claude-3-sonnet'],
  personalization: ['anthropic/claude-3-sonnet', 'openai/gpt-4o', 'openai/gpt-4o-mini'],
  content_generation: ['anthropic/claude-3-sonnet', 'openai/gpt-4o-mini', 'meta-llama/llama-3.1-8b-instruct']
}

class AIIntegrationEngine {
  private models: AIModel[] = DEFAULT_MODELS
  private cache = new Map<string, { response: AIResponse; expires: number }>()
  private costMetrics: CostMetrics = {
    totalCost: 0,
    totalTokens: 0,
    requestsCount: 0,
    averageCostPerRequest: 0,
    costByModel: {},
    costByTask: {}
  }
  private browser?: Browser
  private scrapingMetrics = {
    totalRequests: 0,
    successfulScrapes: 0,
    failedScrapes: 0,
    blockedRequests: 0,
    averageDuration: 0
  }

  constructor() {
    this.loadCustomModels()
    this.initializeCostTracking()
  }

  /**
   * Load custom model configurations from database
   */
  private async loadCustomModels(): Promise<void> {
    try {
      const result = await query('SELECT * FROM ai_models WHERE active = true ORDER BY priority DESC')
      if (result.rows.length > 0) {
        this.models = result.rows.map(row => ({
          id: row.id,
          name: row.name,
          provider: row.provider,
          costPerToken: row.cost_per_token,
          maxTokens: row.max_tokens,
          capabilities: row.capabilities,
          priority: row.priority
        }))
      }
    } catch (error) {
      console.warn('Failed to load custom AI models, using defaults:', error)
    }
  }

  /**
   * Initialize cost tracking from database
   */
  private async initializeCostTracking(): Promise<void> {
    try {
      const result = await query(`
        SELECT
          SUM(cost) as total_cost,
          SUM(tokens_used) as total_tokens,
          COUNT(*) as requests_count,
          model,
          task
        FROM ai_requests
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY model, task
      `)

      for (const row of result.rows) {
        this.costMetrics.totalCost += parseFloat(row.total_cost) || 0
        this.costMetrics.totalTokens += parseInt(row.total_tokens) || 0
        this.costMetrics.requestsCount += parseInt(row.requests_count) || 0

        if (row.model) {
          this.costMetrics.costByModel[row.model] = (this.costMetrics.costByModel[row.model] || 0) + parseFloat(row.total_cost)
        }
        if (row.task) {
          this.costMetrics.costByTask[row.task] = (this.costMetrics.costByTask[row.task] || 0) + parseFloat(row.total_cost)
        }
      }

      this.costMetrics.averageCostPerRequest = this.costMetrics.requestsCount > 0
        ? this.costMetrics.totalCost / this.costMetrics.requestsCount
        : 0

    } catch (error) {
      console.warn('Failed to initialize cost tracking:', error)
    }
  }

  /**
   * Select optimal model for task (cost-effective)
   */
  private selectModelForTask(task: string, requiredCapabilities: string[] = []): AIModel {
    const preferredModels = TASK_MODEL_PREFERENCES[task] || []

    // Filter models by capabilities and availability
    let candidates = this.models.filter(model =>
      requiredCapabilities.every(cap => model.capabilities.includes(cap))
    )

    if (candidates.length === 0) {
      candidates = this.models // Fallback to all models
    }

    // Prioritize by task preferences, then by cost
    candidates.sort((a, b) => {
      const aPreferred = preferredModels.includes(a.id) ? 1 : 0
      const bPreferred = preferredModels.includes(b.id) ? 1 : 0

      if (aPreferred !== bPreferred) return bPreferred - aPreferred
      return a.costPerToken - b.costPerToken // Cheaper first
    })

    return candidates[0] || this.models[0]
  }

  /**
   * Check cache for response
   */
  private getCachedResponse(cacheKey: string): AIResponse | null {
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expires > Date.now()) {
      return { ...cached.response, cached: true }
    }
    if (cached) {
      this.cache.delete(cacheKey) // Expired
    }
    return null
  }

  /**
   * Cache response
   */
  private setCachedResponse(cacheKey: string, response: AIResponse, ttlMinutes: number = 60): void {
    this.cache.set(cacheKey, {
      response: { ...response, cached: false },
      expires: Date.now() + (ttlMinutes * 60 * 1000)
    })
  }

  /**
   * Generate cache key for request
   */
  private generateCacheKey(request: AIRequest): string {
    const keyData = {
      prompt: request.prompt.substring(0, 100), // First 100 chars
      model: request.model,
      task: request.task,
      temperature: request.temperature
    }
    return `ai_${Buffer.from(JSON.stringify(keyData)).toString('base64')}`
  }

  /**
   * Make API call to OpenRouter
   */
  private async callOpenRouter(request: AIRequest, model: AIModel): Promise<AIResponse> {
    const apiKey = appEnv.openRouterApiKey()
    if (!apiKey) {
      return {
        success: false,
        content: '',
        model: model.id,
        tokensUsed: 0,
        cost: 0,
        cached: false,
        error: 'OpenRouter API key not configured'
      }
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': appEnv.baseUrl(),
          'X-Title': 'Xavira Orbit Cold Email Platform'
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: 'user', content: request.prompt }],
          max_tokens: Math.min(request.maxTokens || 1000, model.maxTokens),
          temperature: request.temperature || 0.7,
          stream: false
        })
      })

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content || ''
      const tokensUsed = data.usage?.total_tokens || 0
      const cost = (tokensUsed / 1000) * model.costPerToken

      // Update cost metrics
      this.costMetrics.totalCost += cost
      this.costMetrics.totalTokens += tokensUsed
      this.costMetrics.requestsCount += 1
      this.costMetrics.averageCostPerRequest = this.costMetrics.totalCost / this.costMetrics.requestsCount
      this.costMetrics.costByModel[model.id] = (this.costMetrics.costByModel[model.id] || 0) + cost
      this.costMetrics.costByTask[request.task] = (this.costMetrics.costByTask[request.task] || 0) + cost

      // Log to database
      await this.logRequest(request, model, tokensUsed, cost, true)

      return {
        success: true,
        content,
        model: model.id,
        tokensUsed,
        cost,
        cached: false
      }

    } catch (error) {
      console.error('OpenRouter API call failed:', error)

      // Log failed request
      await this.logRequest(request, model, 0, 0, false, error instanceof Error ? error.message : 'Unknown error')

      return {
        success: false,
        content: '',
        model: model.id,
        tokensUsed: 0,
        cost: 0,
        cached: false,
        error: error instanceof Error ? error.message : 'API call failed'
      }
    }
  }

  /**
   * Log AI request to database
   */
  private async logRequest(
    request: AIRequest,
    model: AIModel,
    tokensUsed: number,
    cost: number,
    success: boolean,
    error?: string
  ): Promise<void> {
    try {
      await query(`
        INSERT INTO ai_requests (
          id, task, model, prompt_length, tokens_used, cost, success, error, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        request.task,
        model.id,
        request.prompt.length,
        tokensUsed,
        cost,
        success,
        error,
        new Date()
      ])
    } catch (logError) {
      console.warn('Failed to log AI request:', logError)
    }
  }

  /**
   * Initialize browser for scraping
   */
  private async initializeBrowser(): Promise<void> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      })
    }
  }

  /**
   * Extract emails from text using regex
   */
  private extractEmails(text: string): string[] {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
    const matches = text.match(emailRegex) || []
    return [...new Set(matches)] // Remove duplicates
  }

  /**
   * Extract phone numbers from text
   */
  private extractPhoneNumbers(text: string): string[] {
    // Multiple phone number formats
    const phoneRegexes = [
      /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, // US format: 123-456-7890
      /\b\(\d{3}\)\s*\d{3}[-.]?\d{4}\b/g, // (123) 456-7890
      /\b\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{4,10}\b/g, // International
      /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{4,10}/g // +1 123 456 7890
    ]

    const phones: string[] = []
    for (const regex of phoneRegexes) {
      const matches = text.match(regex) || []
      phones.push(...matches)
    }

    return [...new Set(phones)]
  }

  /**
   * Extract social media profiles
   */
  private extractSocialProfiles(text: string, url: string): ScrapedContactData['socialProfiles'] {
    const profiles: ScrapedContactData['socialProfiles'] = {}

    // LinkedIn
    const linkedinMatch = text.match(/linkedin\.com\/in\/[^\/\s"']+/i) ||
                         url.match(/linkedin\.com\/in\/([^\/\s]+)/i)
    if (linkedinMatch) {
      profiles.linkedin = linkedinMatch[0].startsWith('http')
        ? linkedinMatch[0]
        : `https://linkedin.com/in/${linkedinMatch[1] || linkedinMatch[0]}`
    }

    // Twitter/X
    const twitterMatch = text.match(/twitter\.com\/[^\/\s"']+|x\.com\/[^\/\s"']+/i)
    if (twitterMatch) {
      profiles.twitter = twitterMatch[0].startsWith('http')
        ? twitterMatch[0]
        : `https://twitter.com/${twitterMatch[0].split('/').pop()}`
    }

    // Facebook
    const facebookMatch = text.match(/facebook\.com\/[^\/\s"']+/i)
    if (facebookMatch) {
      profiles.facebook = facebookMatch[0].startsWith('http')
        ? facebookMatch[0]
        : `https://facebook.com/${facebookMatch[0].split('/').pop()}`
    }

    // Instagram
    const instagramMatch = text.match(/instagram\.com\/[^\/\s"']+/i)
    if (instagramMatch) {
      profiles.instagram = instagramMatch[0].startsWith('http')
        ? instagramMatch[0]
        : `https://instagram.com/${instagramMatch[0].split('/').pop()}`
    }

    // GitHub
    const githubMatch = text.match(/github\.com\/[^\/\s"']+/i)
    if (githubMatch) {
      profiles.github = githubMatch[0].startsWith('http')
        ? githubMatch[0]
        : `https://github.com/${githubMatch[0].split('/').pop()}`
    }

    return profiles
  }

  /**
   * Extract addresses from text
   */
  private extractAddresses(text: string): string[] {
    // Simple address pattern matching
    const addressPatterns = [
      /\d+\s+[A-Za-z0-9\s,.-]+,\s*[A-Za-z\s]+,\s*\d{5}/g, // Street, City, ZIP
      /\d+\s+[A-Za-z0-9\s,.-]+,\s*[A-Za-z\s]+/g // Street, City
    ]

    const addresses: string[] = []
    for (const pattern of addressPatterns) {
      const matches = text.match(pattern) || []
      addresses.push(...matches)
    }

    return [...new Set(addresses)]
  }

  /**
   * Scrape contact data from webpage
   */
  async scrapeContactData(request: ScrapingRequest): Promise<ScrapingResult> {
    const startTime = Date.now()
    this.scrapingMetrics.totalRequests++

    try {
      await this.initializeBrowser()
      if (!this.browser) {
        throw new Error('Failed to initialize browser')
      }

      const page = await this.browser.newPage()

      // Anti-detection measures
      if (request.antiDetection) {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
        await page.setViewport({ width: 1366, height: 768 })
        await page.setExtraHTTPHeaders({
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        })
      }

      // Navigate with timeout
      await page.goto(request.url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      })

      // Wait for content to load
      await page.waitForTimeout(2000)

      // Extract all text content
      const content = await page.evaluate(() => {
        const elements = document.querySelectorAll('*')
        let text = ''
        for (const element of elements) {
          if (element.textContent && element.textContent.trim()) {
            text += element.textContent.trim() + ' '
          }
        }
        return text
      })

      // Extract structured data if available
      const structuredData = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]')
        const data: any[] = []
        for (const script of scripts) {
          try {
            data.push(JSON.parse(script.textContent || ''))
          } catch (e) {
            // Ignore invalid JSON
          }
        }
        return data
      })

      await page.close()

      // Process extracted data
      const emails = this.extractEmails(content)
      const phoneNumbers = this.extractPhoneNumbers(content)
      const addresses = this.extractAddresses(content)
      const socialProfiles = this.extractSocialProfiles(content, request.url)

      // Extract additional info from structured data
      let jobTitle, company, website, bio, location, industry, companySize, revenue, technologies

      for (const data of structuredData) {
        if (data['@type'] === 'Person') {
          jobTitle = data.jobTitle
          bio = data.description
        }
        if (data['@type'] === 'Organization') {
          company = data.name
          website = data.url
          industry = data.industry
          location = data.address?.streetAddress
        }
      }

      // Extract technologies from meta tags and scripts
      const techStack = await page.evaluate(() => {
        const techs: string[] = []
        const scripts = document.querySelectorAll('script[src]')
        for (const script of scripts) {
          const src = script.getAttribute('src') || ''
          if (src.includes('jquery')) techs.push('jQuery')
          if (src.includes('react')) techs.push('React')
          if (src.includes('angular')) techs.push('Angular')
          if (src.includes('vue')) techs.push('Vue.js')
          if (src.includes('wordpress')) techs.push('WordPress')
        }
        return techs
      })

      const scrapedData: ScrapedContactData = {
        emails,
        phoneNumbers,
        addresses,
        socialProfiles,
        jobTitle,
        company,
        website,
        bio,
        location,
        industry,
        companySize,
        revenue,
        technologies: techStack,
        confidence: this.calculateConfidence(emails, phoneNumbers, socialProfiles),
        source: request.url,
        scrapedAt: new Date()
      }

      this.scrapingMetrics.successfulScrapes++
      const duration = Date.now() - startTime
      this.scrapingMetrics.averageDuration = (this.scrapingMetrics.averageDuration + duration) / 2

      return {
        success: true,
        data: scrapedData,
        requestCount: 1,
        duration
      }

    } catch (error) {
      this.scrapingMetrics.failedScrapes++
      console.error('Scraping failed:', error)

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Scraping failed',
        requestCount: 1,
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Calculate confidence score for scraped data
   */
  private calculateConfidence(emails: string[], phones: string[], profiles: any): number {
    let score = 0

    if (emails.length > 0) score += 0.4
    if (phones.length > 0) score += 0.3
    if (Object.keys(profiles).length > 0) score += 0.3

    // Bonus for multiple data points
    if (emails.length > 1) score += 0.1
    if (phones.length > 1) score += 0.1

    return Math.min(score, 1.0)
  }

  /**
   * Bulk scrape multiple URLs
   */
  async bulkScrape(urls: string[], type: ScrapingRequest['type'] = 'general'): Promise<ScrapingResult[]> {
    const results: ScrapingResult[] = []

    for (const url of urls) {
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000)) // 2 second delay

      const result = await this.scrapeContactData({ url, type })
      results.push(result)

      // Stop if too many failures
      const failureRate = this.scrapingMetrics.failedScrapes / this.scrapingMetrics.totalRequests
      if (failureRate > 0.5) {
        console.warn('High failure rate detected, stopping bulk scrape')
        break
      }
    }

    return results
  }

  /**
   * Get scraping metrics
   */
  getScrapingMetrics() {
    return { ...this.scrapingMetrics }
  }

  /**
   * Clean up browser instance
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = undefined
    }
  }

  /**
   * Execute AI request with cost optimization
   */
  async executeRequest(request: AIRequest): Promise<AIResponse> {
    // Check token limits
    const maxTokens = appEnv.aiMaxTokensPerRequest() || 2000
    if (request.maxTokens && request.maxTokens > maxTokens) {
      return {
        success: false,
        content: '',
        model: '',
        tokensUsed: 0,
        cost: 0,
        cached: false,
        error: `Token limit exceeded: ${request.maxTokens} > ${maxTokens}`
      }
    }

    // Check cost budget
    const dailyCostLimit = appEnv.aiDailyCostLimit() || 50 // $50 default
    if (this.costMetrics.totalCost > dailyCostLimit) {
      return {
        success: false,
        content: '',
        model: '',
        tokensUsed: 0,
        cost: 0,
        cached: false,
        error: `Daily cost limit exceeded: $${this.costMetrics.totalCost.toFixed(2)} > $${dailyCostLimit}`
      }
    }

    // Check cache first
    const cacheKey = this.generateCacheKey(request)
    const cachedResponse = this.getCachedResponse(cacheKey)
    if (cachedResponse) {
      return cachedResponse
    }

    // Select optimal model
    const model = request.model
      ? this.models.find(m => m.id === request.model) || this.selectModelForTask(request.task)
      : this.selectModelForTask(request.task)

    if (!model) {
      return {
        success: false,
        content: '',
        model: '',
        tokensUsed: 0,
        cost: 0,
        cached: false,
        error: 'No suitable AI model available'
      }
    }

    // Execute request
    const response = await this.callOpenRouter(request, model)

    // Cache successful responses
    if (response.success && request.task !== 'content_generation') { // Don't cache generative content
      this.setCachedResponse(cacheKey, response)
    }

    return response
  }

  /**
   * Get cost metrics
   */
  getCostMetrics(): CostMetrics {
    return { ...this.costMetrics }
  }

  /**
   * Get available models
   */
  getModels(): AIModel[] {
    return [...this.models]
  }

  /**
   * Update model configuration
   */
  async updateModel(modelId: string, updates: Partial<AIModel>): Promise<void> {
    const index = this.models.findIndex(m => m.id === modelId)
    if (index >= 0) {
      this.models[index] = { ...this.models[index], ...updates }
    }

    // Persist to database
    try {
      await query(`
        INSERT INTO ai_models (id, name, provider, cost_per_token, max_tokens, capabilities, priority, active, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          provider = EXCLUDED.provider,
          cost_per_token = EXCLUDED.cost_per_token,
          max_tokens = EXCLUDED.max_tokens,
          capabilities = EXCLUDED.capabilities,
          priority = EXCLUDED.priority,
          active = EXCLUDED.active,
          updated_at = EXCLUDED.updated_at
      `, [
        updates.id || modelId,
        updates.name,
        updates.provider,
        updates.costPerToken,
        updates.maxTokens,
        updates.capabilities,
        updates.priority,
        true,
        new Date()
      ])
    } catch (error) {
      console.error('Failed to persist model update:', error)
    }
  }

  /**
   * Optimize prompt for cost reduction
   */
  optimizePromptForCost(prompt: string, task: string): string {
    // Remove unnecessary formatting and whitespace
    let optimized = prompt.trim()

    // For spam detection, keep it concise
    if (task === 'spam_detection') {
      optimized = optimized.substring(0, 500) // Limit to 500 chars
    }

    // For reply analysis, focus on key parts
    if (task === 'reply_analysis') {
      // Extract subject and body summary
      const lines = optimized.split('\n')
      const subject = lines.find(l => l.toLowerCase().includes('subject:')) || lines[0]
      const body = lines.slice(1, 5).join('\n') // First 5 lines
      optimized = `Subject: ${subject}\nBody: ${body}`
    }

    return optimized
  }

  /**
   * Get cost optimization recommendations
   */
  getCostOptimizationRecommendations(): string[] {
    const recommendations: string[] = []

    if (this.costMetrics.averageCostPerRequest > 0.01) { // > $0.01 per request
      recommendations.push('Consider using cheaper models for routine tasks')
    }

    const highCostTasks = Object.entries(this.costMetrics.costByTask)
      .filter(([, cost]) => cost > 10) // > $10
      .map(([task]) => task)

    if (highCostTasks.length > 0) {
      recommendations.push(`High-cost tasks: ${highCostTasks.join(', ')} - optimize prompts or use cheaper models`)
    }

    const cacheHitRate = this.cache.size / (this.cache.size + this.costMetrics.requestsCount) * 100
    if (cacheHitRate < 50) {
      recommendations.push('Low cache hit rate - review caching strategy')
    }

    return recommendations
  }
}

// Singleton instance
export const aiIntegration = new AIIntegrationEngine()

/**
 * Convenience functions for common AI tasks
 */

// Spam detection with cost optimization
export async function detectSpam(content: string): Promise<{ isSpam: boolean; confidence: number; reason: string }> {
  const optimizedPrompt = aiIntegration.optimizePromptForCost(
    `Analyze this email content for spam characteristics. Respond with JSON: {"isSpam": boolean, "confidence": number 0-1, "reason": string}\n\nContent: ${content}`,
    'spam_detection'
  )

  const response = await aiIntegration.executeRequest({
    prompt: optimizedPrompt,
    task: 'spam_detection',
    maxTokens: 200
  })

  if (!response.success) {
    return { isSpam: false, confidence: 0, reason: 'Analysis failed' }
  }

  try {
    const result = JSON.parse(response.content)
    return {
      isSpam: result.isSpam || false,
      confidence: result.confidence || 0,
      reason: result.reason || 'Unknown'
    }
  } catch {
    return { isSpam: false, confidence: 0, reason: 'Parse error' }
  }
}

// Reply analysis with cost control
export async function analyzeReply(emailContent: string, context?: Record<string, any>): Promise<{
  sentiment: 'positive' | 'negative' | 'neutral'
  intent: string
  shouldStopSequence: boolean
  suggestedAction: string
}> {
  const optimizedPrompt = aiIntegration.optimizePromptForCost(
    `Analyze this email reply. Respond with JSON: {"sentiment": "positive|negative|neutral", "intent": string, "shouldStopSequence": boolean, "suggestedAction": string}\n\nContext: ${JSON.stringify(context)}\n\nEmail: ${emailContent}`,
    'reply_analysis'
  )

  const response = await aiIntegration.executeRequest({
    prompt: optimizedPrompt,
    task: 'reply_analysis',
    maxTokens: 300
  })

  if (!response.success) {
    return {
      sentiment: 'neutral',
      intent: 'unknown',
      shouldStopSequence: false,
      suggestedAction: 'continue'
    }
  }

  try {
    const result = JSON.parse(response.content)
    return {
      sentiment: result.sentiment || 'neutral',
      intent: result.intent || 'unknown',
      shouldStopSequence: result.shouldStopSequence || false,
      suggestedAction: result.suggestedAction || 'continue'
    }
  } catch {
    return {
      sentiment: 'neutral',
      intent: 'unknown',
      shouldStopSequence: false,
      suggestedAction: 'continue'
    }
  }
}

// Personalization with model selection
export async function generatePersonalization(contactData: Record<string, any>, campaignContext: string): Promise<string> {
  const prompt = `Generate personalized email content based on contact data and campaign context. Keep it professional and engaging.\n\nContact: ${JSON.stringify(contactData)}\n\nCampaign: ${campaignContext}`

  const response = await aiIntegration.executeRequest({
    prompt,
    task: 'personalization',
    maxTokens: 500,
    temperature: 0.8
  })

  return response.success ? response.content : ''
}

// Content generation with fallback
export async function generateContent(template: string, variables: Record<string, any>): Promise<string> {
  const prompt = `Generate email content using this template and variables.\n\nTemplate: ${template}\n\nVariables: ${JSON.stringify(variables)}`

  const response = await aiIntegration.executeRequest({
    prompt,
    task: 'content_generation',
    maxTokens: 1000,
    temperature: 0.7
  })

  return response.success ? response.content : template // Fallback to template
}

/**
 * Scrape contact data from URL
 */
export async function scrapeContacts(url: string, type: ScrapingRequest['type'] = 'general', antiDetection: boolean = true): Promise<ScrapedContactData | null> {
  const result = await aiIntegration.scrapeContactData({
    url,
    type,
    antiDetection
  })

  return result.success && result.data ? result.data : null
}

/**
 * Bulk scrape multiple contact sources
 */
export async function bulkScrapeContacts(urls: string[], type: ScrapingRequest['type'] = 'general'): Promise<ScrapedContactData[]> {
  const results = await aiIntegration.bulkScrape(urls, type)
  return results.filter(r => r.success && r.data).map(r => r.data!)
}

/**
 * Enrich contact data with scraped information
 */
export async function enrichContactWithScraping(contactId: string, urls: string[]): Promise<void> {
  try {
    const scrapedData = await bulkScrapeContacts(urls)

    if (scrapedData.length === 0) return

    // Combine all scraped data
    const combined: ScrapedContactData = {
      emails: [],
      phoneNumbers: [],
      addresses: [],
      socialProfiles: {},
      confidence: 0,
      source: urls.join(', '),
      scrapedAt: new Date()
    }

    for (const data of scrapedData) {
      combined.emails.push(...data.emails)
      combined.phoneNumbers.push(...data.phoneNumbers)
      combined.addresses.push(...data.addresses)
      Object.assign(combined.socialProfiles, data.socialProfiles)
      combined.confidence = Math.max(combined.confidence, data.confidence)

      // Take the most complete info
      if (data.jobTitle && !combined.jobTitle) combined.jobTitle = data.jobTitle
      if (data.company && !combined.company) combined.company = data.company
      if (data.website && !combined.website) combined.website = data.website
      if (data.bio && !combined.bio) combined.bio = data.bio
      if (data.location && !combined.location) combined.location = data.location
      if (data.industry && !combined.industry) combined.industry = data.industry
    }

    // Remove duplicates
    combined.emails = [...new Set(combined.emails)]
    combined.phoneNumbers = [...new Set(combined.phoneNumbers)]
    combined.addresses = [...new Set(combined.addresses)]

    // Update contact in database
    await query(`
      UPDATE contacts
      SET
        enrichment_data = enrichment_data || $2,
        updated_at = $3
      WHERE id = $1
    `, [
      contactId,
      {
        scraped: combined,
        scraped_at: combined.scrapedAt
      },
      new Date()
    ])

  } catch (error) {
    console.error('Failed to enrich contact with scraping:', error)
  }
}

/**
 * Scrape LinkedIn profile
 */
export async function scrapeLinkedInProfile(profileUrl: string): Promise<ScrapedContactData | null> {
  return await scrapeContacts(profileUrl, 'linkedin', true)
}

/**
 * Scrape company contact page
 */
export async function scrapeCompanyContacts(companyUrl: string): Promise<ScrapedContactData | null> {
  // Try common contact page URLs
  const contactUrls = [
    `${companyUrl}/contact`,
    `${companyUrl}/contact-us`,
    `${companyUrl}/about`,
    `${companyUrl}/team`,
    companyUrl
  ]

  for (const url of contactUrls) {
    try {
      const data = await scrapeContacts(url, 'contact_page', true)
      if (data && (data.emails.length > 0 || data.phoneNumbers.length > 0)) {
        return data
      }
    } catch (error) {
      // Continue to next URL
    }
  }

  return null
}

/**
 * Initialize AI integration
 */
export async function initializeAIIntegration(): Promise<void> {
  console.log('🤖 Initializing AI Integration Engine...')

  // Load models and metrics
  await aiIntegration['loadCustomModels']()
  await aiIntegration['initializeCostTracking']()

  console.log('✅ AI Integration initialized with cost controls')
}

/**
 * Get AI system status
 */
export async function getAIStatus(): Promise<{
  healthy: boolean
  models: number
  totalCost: number
  totalTokens: number
  recommendations: string[]
  scraping: {
    totalRequests: number
    successRate: number
    averageDuration: number
  }
}> {
  const metrics = aiIntegration.getCostMetrics()
  const scrapingMetrics = aiIntegration.getScrapingMetrics()
  const recommendations = aiIntegration.getCostOptimizationRecommendations()

  return {
    healthy: true, // Basic health check
    models: aiIntegration.getModels().length,
    totalCost: metrics.totalCost,
    totalTokens: metrics.totalTokens,
    recommendations,
    scraping: {
      totalRequests: scrapingMetrics.totalRequests,
      successRate: scrapingMetrics.totalRequests > 0
        ? scrapingMetrics.successfulScrapes / scrapingMetrics.totalRequests
        : 0,
      averageDuration: scrapingMetrics.averageDuration
    }
  }
}
