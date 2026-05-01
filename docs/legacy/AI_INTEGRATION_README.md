# AI Integration & Web Scraping System

## Overview

The AI Integration system provides comprehensive AI-powered analysis and web scraping capabilities for the Sovereign Engine cold email platform. It includes cost-optimized LLM usage, intelligent model selection, response caching, and automated contact data extraction from websites.

## Features

### 🤖 AI Integration Engine
- **Multi-Provider Support**: OpenRouter API integration with multiple AI models
- **Cost Optimization**: Automatic model selection based on task requirements and cost
- **Response Caching**: Intelligent caching to reduce API calls and costs
- **Token Limits**: Configurable token limits and cost budgets
- **Fallback Handling**: Graceful degradation when APIs are unavailable

### 🕷️ Web Scraping Engine
- **Contact Data Extraction**: Extracts emails, phone numbers, addresses, and social profiles
- **Anti-Detection Measures**: Randomized user agents, delays, and browser fingerprints
- **Structured Data Parsing**: Intelligent parsing of contact information with confidence scoring
- **Bulk Processing**: Concurrent scraping with rate limiting
- **Error Recovery**: Robust error handling and retry mechanisms

### 📊 Analytics & Monitoring
- **Cost Tracking**: Real-time cost monitoring and budget enforcement
- **Performance Metrics**: Success rates, response times, and scraping statistics
- **Health Monitoring**: System health checks and status reporting
- **Usage Analytics**: Detailed usage statistics and optimization recommendations

## Setup

### Environment Variables

Add these to your `.env` file:

```bash
# OpenRouter API Configuration
OPENROUTER_API_KEY=your_openrouter_api_key_here

# AI Cost Controls
AI_MAX_TOKENS_PER_REQUEST=4000
AI_DAILY_COST_LIMIT=10.00
AI_CACHE_ENABLED=true

# Model Preferences (optional)
AI_SPAM_MODEL=gpt-3.5-turbo
AI_REPLY_MODEL=gpt-4
AI_SCRAPING_MODEL=gpt-3.5-turbo

# Web Scraping Configuration
SCRAPING_ENABLED=true
SCRAPING_MAX_CONCURRENT=3
SCRAPING_REQUEST_TIMEOUT=30000
SCRAPING_USER_AGENT_ROTATION=true
```

### Dependencies

The system requires Puppeteer for web scraping. Chrome/Chromium must be installed:

```bash
# Install Chrome (choose one method):
# Method 1: Download from https://www.google.com/chrome/
# Method 2: Homebrew (macOS)
brew install --cask google-chrome

# Method 3: Use system Chrome
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

### Database Setup

Run the database initialization:

```bash
pnpm run db:init
```

This creates the necessary tables:
- `ai_models`: Custom model configurations
- `ai_requests`: Request logging and cost tracking
- `scraping_requests`: Scraping job tracking
- `scraped_contacts`: Extracted contact data storage

## Usage

### AI Functions

```typescript
import {
  detectSpam,
  analyzeReply,
  generateEmailContent,
  getAIStatus
} from '@/lib/ai-integration'

// Spam detection
const spamResult = await detectSpam('Buy cheap viagra now!')
// Returns: { isSpam: true, confidence: 0.95, reason: 'Spam indicators detected' }

// Reply analysis
const replyResult = await analyzeReply(emailContent, context)
// Returns: { sentiment: 'positive', intent: 'interested', shouldStopSequence: false }

// Content generation
const content = await generateEmailContent({
  campaignType: 'product_launch',
  targetAudience: 'tech_startups',
  keyPoints: ['feature1', 'benefit1']
})

// System status
const status = await getAIStatus()
// Returns cost metrics, health status, and optimization recommendations
```

### Web Scraping

```typescript
import { scrapeContacts, bulkScrapeContacts } from '@/lib/ai-integration'

// Single contact scraping
const contactData = await scrapeContacts('https://example.com/contact', 'business')
// Returns: {
//   emails: ['contact@example.com'],
//   phoneNumbers: ['+1-555-0123'],
//   addresses: ['123 Main St, City, State'],
//   socialProfiles: { linkedin: 'https://linkedin.com/in/contact' },
//   company: 'Example Corp',
//   jobTitle: 'CEO',
//   confidence: 0.85
// }

// Bulk scraping
const results = await bulkScrapeContacts([
  { url: 'https://company1.com/team', category: 'business' },
  { url: 'https://company2.com/about', category: 'business' }
])
```

## API Endpoints

### AI Analysis Endpoints

- `POST /api/ai/spam-detect` - Detect spam content
- `POST /api/ai/reply-analyze` - Analyze email replies
- `POST /api/ai/content-generate` - Generate email content
- `GET /api/ai/status` - Get system status and metrics

### Scraping Endpoints

- `POST /api/scraping/contacts` - Scrape contact data from URL
- `POST /api/scraping/bulk` - Bulk contact scraping
- `GET /api/scraping/status` - Get scraping statistics

## Cost Optimization

### Model Selection Strategy

The system automatically selects the most cost-effective model for each task:

- **Spam Detection**: Uses GPT-3.5-turbo (fast, cheap)
- **Reply Analysis**: Uses GPT-4 (higher accuracy needed)
- **Content Generation**: Uses GPT-4 (creative writing)
- **Simple Tasks**: Uses GPT-3.5-turbo or Claude-3-Haiku

### Cost Controls

- **Daily Budgets**: Configurable daily spending limits
- **Token Limits**: Maximum tokens per request
- **Caching**: Reduces repeated API calls
- **Fallbacks**: Uses cached responses when budget exceeded

### Monitoring Costs

```typescript
const status = await getAIStatus()
console.log(`Total Cost: $${status.totalCost}`)
console.log(`Requests Today: ${status.totalRequests}`)
console.log(`Average Cost/Request: $${status.averageCostPerRequest}`)
```

## Testing

Run the AI integration test:

```bash
pnpm run test:ai
```

This tests:
- System initialization
- AI model availability
- Spam detection
- Reply analysis
- Web scraping (requires Chrome)
- Cost tracking

## Architecture

### Core Components

1. **AIIntegrationEngine**: Singleton managing all AI operations
2. **ScrapingEngine**: Handles web scraping with anti-detection
3. **CostTracker**: Monitors and enforces spending limits
4. **CacheManager**: Intelligent response caching
5. **ModelSelector**: Chooses optimal models for tasks

### Data Flow

1. **Request Processing**: Validate request and check cache
2. **Model Selection**: Choose appropriate AI model based on task/cost
3. **API Call**: Execute request with timeout and error handling
4. **Cost Tracking**: Log usage and update budgets
5. **Caching**: Store successful responses
6. **Response**: Return results with metadata

### Error Handling

- **API Failures**: Automatic retry with exponential backoff
- **Rate Limits**: Queue requests and respect rate limits
- **Cost Limits**: Fallback to cached responses or cheaper models
- **Network Issues**: Graceful degradation with error messages

## Security Considerations

- **API Keys**: Stored securely in environment variables
- **Rate Limiting**: Prevents abuse and manages costs
- **Input Validation**: Sanitizes all inputs to prevent injection
- **Scraping Ethics**: Respects robots.txt and implements delays
- **Data Privacy**: Only extracts publicly available contact information

## Performance Optimization

- **Concurrent Processing**: Multiple requests processed simultaneously
- **Connection Pooling**: Reused connections for efficiency
- **Response Compression**: Reduced bandwidth usage
- **Caching Strategy**: Intelligent cache invalidation and TTL
- **Resource Limits**: Memory and CPU usage controls

## Troubleshooting

### Common Issues

1. **Chrome Not Found**: Install Chrome or set `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`
2. **API Key Missing**: Add `OPENROUTER_API_KEY` to environment
3. **Database Connection**: Ensure PostgreSQL is running
4. **Cost Limit Exceeded**: Increase budget or use caching
5. **Scraping Blocked**: Rotate user agents or reduce frequency

### Debug Mode

Enable debug logging:

```bash
DEBUG=ai-integration:* pnpm run dev
```

### Health Checks

```typescript
const status = await getAIStatus()
if (!status.healthy) {
  console.error('AI system unhealthy:', status.errors)
}
```

## Future Enhancements

- **Additional AI Providers**: Support for more LLM providers
- **Advanced Scraping**: LinkedIn and social media integration
- **Machine Learning**: Custom models for spam detection
- **Real-time Analytics**: Live cost and performance dashboards
- **Auto-scaling**: Dynamic model selection based on load

## Contributing

1. Follow TypeScript best practices
2. Add comprehensive error handling
3. Include cost impact analysis for changes
4. Test with both success and failure scenarios
5. Update documentation for new features

## License

This system is part of the Sovereign Engine platform and follows the same licensing terms.