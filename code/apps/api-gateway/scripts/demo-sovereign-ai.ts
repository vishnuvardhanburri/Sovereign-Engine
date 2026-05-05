#!/usr/bin/env node
// @ts-nocheck

/**
 * Sovereign AI Demo
 * Interactive demonstration of the Sovereign AI assistant capabilities
 */

import 'dotenv/config'
import { processSovereignAIRequest } from '../lib/sovereign-ai'
import * as readline from 'readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

async function demo() {
  console.log('🤖 Sovereign AI Assistant Demo')
  console.log('==========================\n')
  console.log('Welcome to Sovereign AI! I\'m your intelligent assistant for cold email campaign management.')
  console.log('I can help you with campaigns, contacts, content generation, analytics, and more.\n')
  console.log('Try commands like:')
  console.log('• "Create a new campaign for tech startups"')
  console.log('• "Analyze my contact list"')
  console.log('• "Generate a subject line for SaaS products"')
  console.log('• "Check this email for spam"')
  console.log('• "Scrape contacts from a website"')
  console.log('• Type "quit" to exit\n')

  let conversationCount = 0
  const userId = `demo-${Date.now()}`

  function askQuestion() {
    rl.question('You: ', async (input) => {
      if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
        console.log('\n👋 Thanks for trying Sovereign AI! Goodbye!')
        rl.close()
        return
      }

      if (!input.trim()) {
        askQuestion()
        return
      }

      console.log('\n🤔 Thinking...')

      try {
        const startTime = Date.now()
        const response = await processSovereignAIRequest({
          message: input,
          userId,
          context: {
            currentCampaign: conversationCount > 0 ? 'Demo Campaign' : null,
            currentContacts: conversationCount > 1 ? ['demo@example.com'] : [],
            userRole: 'admin',
            recentActions: ['started demo']
          }
        })

        const processingTime = Date.now() - startTime
        conversationCount++

        console.log(`\n🤖 Sovereign AI (${processingTime}ms, $${response.metadata.cost.toFixed(4)}):`)
        console.log(response.response)

        if (response.actions && response.actions.length > 0) {
          console.log('\n💡 Suggested Actions:')
          response.actions.forEach((action, i) => {
            console.log(`   ${i + 1}. ${action.description} (${action.priority} priority)`)
          })
        }

        if (response.suggestedCommands && response.suggestedCommands.length > 0) {
          console.log('\n🔍 Try these commands:')
          response.suggestedCommands.forEach(cmd => {
            console.log(`   • "${cmd}"`)
          })
        }

        console.log(`\n📊 Confidence: ${(response.confidence * 100).toFixed(0)}% | Tokens: ${response.metadata.tokensUsed} | Model: ${response.metadata.model}`)
        console.log('─'.repeat(50))

      } catch (error) {
        console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error')
      }

      console.log()
      askQuestion()
    })
  }

  askQuestion()
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Demo interrupted. Thanks for trying Sovereign AI!')
  rl.close()
  process.exit(0)
})

// Run the demo
demo().catch(console.error)
