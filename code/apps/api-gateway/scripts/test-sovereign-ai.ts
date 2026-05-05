// @ts-nocheck
/**
 * Sovereign AI Assistant Test Script
 * Tests the conversational AI capabilities and OpenRouter integration
 */

import 'dotenv/config'
import { processSovereignAIRequest, getSovereignAI } from '../lib/sovereign-ai'

async function testSovereignAI() {
  console.log('🤖 Testing Sovereign AI Assistant...\n')

  try {
    // Test basic conversation
    console.log('1. Testing basic conversation...')
    const response1 = await processSovereignAIRequest({
      message: "Hello! Can you help me with my cold email campaigns?",
      userId: 'test-user'
    })
    console.log('Response:', response1.response)
    console.log('Confidence:', response1.confidence)
    console.log('Actions:', response1.actions.length)
    console.log('✅ Basic conversation test complete\n')

    // Test campaign creation intent
    console.log('2. Testing campaign creation intent...')
    const response2 = await processSovereignAIRequest({
      message: "Create a new campaign called 'Tech Startup Outreach'",
      userId: 'test-user',
      context: {
        currentCampaign: null,
        currentContacts: [],
        userRole: 'admin'
      }
    })
    console.log('Response:', response2.response)
    console.log('Actions:', response2.actions.map(a => a.description))
    console.log('Suggested Commands:', response2.suggestedCommands)
    console.log('✅ Campaign creation test complete\n')

    // Test content generation
    console.log('3. Testing content generation...')
    const response3 = await processSovereignAIRequest({
      message: "Generate a subject line for a SaaS product launch",
      userId: 'test-user',
      task: 'content_generation'
    })
    console.log('Response:', response3.response)
    console.log('Cost: $' + response3.metadata.cost.toFixed(4))
    console.log('Tokens:', response3.metadata.tokensUsed)
    console.log('✅ Content generation test complete\n')

    // Test contact analysis
    console.log('4. Testing contact analysis...')
    const response4 = await processSovereignAIRequest({
      message: "Analyze my contact list for cold email potential",
      userId: 'test-user',
      context: {
        currentContacts: ['contact1@example.com', 'contact2@example.com'],
        recentActions: ['uploaded contacts', 'created campaign']
      },
      task: 'contact_analysis'
    })
    console.log('Response:', response4.response)
    console.log('Actions:', response4.actions.length > 0 ? response4.actions[0].description : 'None')
    console.log('✅ Contact analysis test complete\n')

    // Test conversation history
    console.log('5. Testing conversation history...')
    const ai = getSovereignAI()
    const history = ai.getConversationHistory('test-user')
    console.log('Conversation history length:', history.length)
    console.log('Last message:', history[history.length - 1]?.content.substring(0, 50) + '...')
    console.log('✅ Conversation history test complete\n')

    // Test scraping intent
    console.log('6. Testing web scraping intent...')
    const response5 = await processSovereignAIRequest({
      message: "Scrape contact information from https://example.com/about",
      userId: 'test-user',
      task: 'scraping'
    })
    console.log('Response:', response5.response)
    console.log('Actions:', response5.actions.map(a => a.description))
    console.log('✅ Web scraping test complete\n')

    // Final summary
    console.log('🎉 Sovereign AI Assistant Test Complete!')
    console.log('✅ Features tested:')
    console.log('   - Natural language processing')
    console.log('   - Intent recognition')
    console.log('   - Action extraction')
    console.log('   - OpenRouter integration')
    console.log('   - Conversation history')
    console.log('   - Cost tracking')
    console.log('   - Suggested commands')
    console.log('   - Context awareness')

    // Performance summary
    const totalCost = [response1, response2, response3, response4, response5]
      .reduce((sum, r) => sum + r.metadata.cost, 0)
    const totalTokens = [response1, response2, response3, response4, response5]
      .reduce((sum, r) => sum + r.metadata.tokensUsed, 0)
    const avgProcessingTime = [response1, response2, response3, response4, response5]
      .reduce((sum, r) => sum + r.metadata.processingTime, 0) / 5

    console.log('\n📊 Performance Summary:')
    console.log(`   Total Cost: $${totalCost.toFixed(4)}`)
    console.log(`   Total Tokens: ${totalTokens}`)
    console.log(`   Average Processing Time: ${avgProcessingTime.toFixed(0)}ms`)
    console.log(`   Cost Efficiency: $${(totalCost / totalTokens * 1000).toFixed(6)} per 1K tokens`)

  } catch (error) {
    console.error('❌ Sovereign AI test failed:', error)
    process.exit(1)
  }
}

// Run the test
testSovereignAI().catch(console.error)
