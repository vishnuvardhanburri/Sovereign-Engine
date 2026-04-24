# Xavira AI Assistant

## Overview

Xavira AI is your intelligent conversational assistant for cold email campaign management. Powered by OpenRouter's AI models, it provides natural language interaction for managing campaigns, analyzing contacts, generating content, and optimizing your cold outreach strategy.

## Features

### 🤖 Conversational AI
- **Natural Language Processing**: Understands and responds to natural language commands
- **Context Awareness**: Remembers conversation history and user preferences
- **Intent Recognition**: Automatically detects user intentions and suggests actions
- **Multi-turn Conversations**: Maintains context across multiple interactions

### 📧 Campaign Management
- Create and configure email campaigns
- Analyze campaign performance
- Generate personalized content
- Optimize sending strategies

### 👥 Contact Intelligence
- Analyze contact lists and segmentation
- Identify high-value prospects
- Enrich contact data with web scraping
- Generate personalized outreach strategies

### 📝 Content Generation
- Create compelling subject lines
- Generate email copy and sequences
- Personalize content for different audiences
- Optimize for spam filters and engagement

### 🔍 Web Scraping Integration
- Extract contact information from websites
- Scrape LinkedIn profiles and company pages
- Enrich contact databases automatically
- Anti-detection measures for reliable scraping

### 📊 Analytics & Insights
- Performance reporting and metrics
- A/B testing recommendations
- Reply analysis and sentiment detection
- Cost optimization suggestions

## Getting Started

### Prerequisites

1. **OpenRouter API Key**: Sign up at [OpenRouter.ai](https://openrouter.ai) and get your API key
2. **Environment Setup**: Add to your `.env` file:
   ```bash
   OPENROUTER_API_KEY=your_api_key_here
   AI_DAILY_COST_LIMIT=10.00
   SCRAPING_ENABLED=true
   ```

### Installation

The Xavira AI assistant is included in the Xavira Orbit platform. Access it through:
- **Web Interface**: Navigate to `/ai-assistant` in your dashboard
- **API**: Use the REST API at `/api/xavira-ai`
- **Programmatic**: Import and use the `XaviraAIAssistant` class

## Usage

### Web Interface

1. Navigate to the AI Assistant page in your dashboard
2. Type natural language commands like:
   - "Create a new campaign for tech startups"
   - "Analyze my contact list for engagement potential"
   - "Generate a subject line for SaaS product launch"
   - "Check this email content for spam"
   - "Scrape contacts from linkedin.com/company/example"

3. The AI will respond with helpful information and suggest actionable steps

### API Usage

```typescript
import { processXaviraAIRequest } from '@/lib/xavira-ai'

// Basic request
const response = await processXaviraAIRequest({
  message: "Help me create a campaign",
  userId: "user123",
  context: {
    currentCampaign: null,
    currentContacts: [],
    userRole: "admin"
  }
})

console.log(response.response) // AI's natural language response
console.log(response.actions) // Suggested actions to take
console.log(response.suggestedCommands) // Follow-up suggestions
```

### Programmatic Usage

```typescript
import { XaviraAIAssistant } from '@/lib/xavira-ai'

const ai = new XaviraAIAssistant()

// Process a request
const response = await ai.processRequest({
  message: "Generate content for my SaaS campaign",
  context: { campaignType: "saas" }
})

// Get conversation history
const history = ai.getConversationHistory("user123")

// Clear history
ai.clearHistory("user123")
```

## Commands & Capabilities

### Campaign Management
- **Create campaigns**: "Create a campaign called 'Q4 Outreach'"
- **Edit campaigns**: "Update campaign settings" or "Change campaign name"
- **Performance analysis**: "Show campaign performance" or "Analyze open rates"

### Contact Management
- **List analysis**: "Analyze my contacts" or "Segment contacts by industry"
- **Prospect identification**: "Find high-value prospects" or "Identify decision makers"
- **Data enrichment**: "Enrich contacts with LinkedIn data"

### Content Generation
- **Subject lines**: "Generate subject lines for B2B SaaS"
- **Email copy**: "Write an email about our new feature"
- **Sequences**: "Create a 5-email follow-up sequence"
- **Personalization**: "Personalize this email for tech executives"

### Compliance & Spam
- **Spam checking**: "Check this email for spam triggers"
- **Compliance review**: "Review content for CAN-SPAM compliance"
- **Optimization**: "Optimize this email for better deliverability"

### Web Scraping
- **Contact extraction**: "Scrape contacts from website.com"
- **LinkedIn profiles**: "Get contact info from LinkedIn profile"
- **Company data**: "Extract team members from company page"

### Analytics & Reporting
- **Performance reports**: "Show me campaign analytics"
- **Reply analysis**: "Analyze email replies for sentiment"
- **Optimization**: "Suggest improvements for my campaigns"

## AI Models & Cost Optimization

### Model Selection
Xavira AI automatically selects the most cost-effective model for each task:

- **GPT-3.5-turbo**: Fast, cheap tasks (spam detection, basic analysis)
- **GPT-4**: Complex tasks (content generation, detailed analysis)
- **Claude-3**: Specialized tasks (compliance, ethical analysis)

### Cost Controls
- **Daily budgets**: Configurable spending limits
- **Token optimization**: Efficient prompt engineering
- **Response caching**: Reuse similar requests
- **Fallback handling**: Graceful degradation when limits exceeded

### Monitoring Costs
```typescript
import { aiIntegration } from '@/lib/ai-integration'

const metrics = aiIntegration.getCostMetrics()
console.log(`Total Cost: $${metrics.totalCost}`)
console.log(`Requests: ${metrics.requestsCount}`)
console.log(`Average Cost/Request: $${metrics.averageCostPerRequest}`)
```

## Advanced Features

### Conversation Memory
- Maintains context across sessions
- Learns user preferences and patterns
- Provides personalized suggestions

### Action Extraction
- Automatically identifies actionable tasks from conversations
- Suggests specific steps to take
- Integrates with platform workflows

### Multi-Modal Responses
- Text responses with suggested actions
- Interactive command suggestions
- Structured data output for API integration

### Error Handling
- Graceful fallbacks when AI services unavailable
- Clear error messages and recovery suggestions
- Automatic retry mechanisms

## Integration Examples

### Campaign Creation Workflow
```typescript
// User: "Create a campaign for fintech startups"
const response = await processXaviraAIRequest({
  message: "Create a campaign for fintech startups",
  task: "campaign_management"
})

// AI suggests actions like:
// - Define target criteria
// - Set up email sequence
// - Configure sending schedule
// - Generate initial content
```

### Contact Enrichment
```typescript
// User: "Enrich my contacts with LinkedIn data"
const response = await processXaviraAIRequest({
  message: "Enrich my contacts with LinkedIn data",
  context: { currentContacts: ["contact1", "contact2"] }
})

// AI initiates scraping workflow and updates contact database
```

### Content Optimization
```typescript
// User: "Optimize this subject line for better open rates"
const response = await processXaviraAIRequest({
  message: "Optimize this subject line for better open rates",
  context: { subjectLine: "Check out our new product" }
})

// AI generates multiple variations with predicted performance
```

## Security & Privacy

- **Data Encryption**: All conversations and data encrypted in transit and at rest
- **Access Control**: User-specific conversation isolation
- **Audit Logging**: Comprehensive logging for compliance
- **Rate Limiting**: Prevents abuse and manages costs
- **Input Validation**: Sanitizes all user inputs

## Performance & Scaling

- **Concurrent Processing**: Handles multiple users simultaneously
- **Response Caching**: Reduces latency for common queries
- **Cost Optimization**: Intelligent model selection and prompt optimization
- **Horizontal Scaling**: Supports multiple AI instances

## Troubleshooting

### Common Issues

1. **Empty Responses**: Check OpenRouter API key configuration
2. **High Costs**: Review daily budget limits and model usage
3. **Slow Responses**: Check internet connection and API rate limits
4. **Scraping Failures**: Ensure Chrome is installed and websites allow scraping

### Debug Mode
```typescript
// Enable detailed logging
process.env.DEBUG = 'xavira-ai:*'
```

### Health Checks
```typescript
import { getXaviraAI } from '@/lib/xavira-ai'

const ai = getXaviraAI()
// Check if AI is responsive
const health = await ai.processRequest({ message: "ping" })
```

## Future Enhancements

- **Voice Integration**: Voice commands and responses
- **Multi-language Support**: International language processing
- **Advanced Analytics**: Predictive performance modeling
- **Integration APIs**: Connect with external tools and platforms
- **Custom Models**: Fine-tuned models for specific industries

## API Reference

### XaviraAIRequest
```typescript
interface XaviraAIRequest {
  message: string                    // User's natural language message
  userId?: string                    // Optional user identifier
  context?: {                        // Optional context information
    currentCampaign?: string
    currentContacts?: string[]
    userRole?: string
    recentActions?: string[]
  }
  task?: string                      // Optional task category
}
```

### XaviraAIResponse
```typescript
interface XaviraAIResponse {
  response: string                   // AI's natural language response
  actions: XaviraAIAction[]          // Suggested actions to take
  confidence: number                 // Confidence score (0-1)
  suggestedCommands?: string[]       // Follow-up command suggestions
  metadata: {                        // Response metadata
    model: string
    tokensUsed: number
    cost: number
    processingTime: number
  }
}
```

## Contributing

1. Follow TypeScript best practices
2. Add comprehensive error handling
3. Include cost impact analysis for new features
4. Test with various conversation scenarios
5. Update documentation for API changes

## License

Part of the Xavira Orbit cold email platform. See main project license for details.