/**
 * Sovereign AI Assistant API Route
 * Handles conversational AI interactions for cold email platform management
 */

import { NextRequest, NextResponse } from 'next/server'
import { processSovereignAIRequest, getSovereignAI, SovereignAIRequest } from '@/lib/sovereign-ai'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, context, task } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      )
    }

    // Prepare AI request
    const aiRequest: SovereignAIRequest = {
      message: message.trim(),
      userId: 'anonymous',
      context: context || {},
      task: task || 'general'
    }

    // Process with Sovereign AI
    const response = await processSovereignAIRequest(aiRequest)

    return NextResponse.json({
      success: true,
      data: response
    })

  } catch (error) {
    console.error('Sovereign AI API error:', error)
    return NextResponse.json(
      {
        error: 'Failed to process AI request',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId') || 'anonymous'

    const ai = getSovereignAI()
    const history = ai.getConversationHistory(userId)

    return NextResponse.json({
      success: true,
      data: {
        history: history.map(h => ({
          role: h.role,
          content: h.content,
          timestamp: h.timestamp.toISOString()
        })),
        totalMessages: history.length
      }
    })

  } catch (error) {
    console.error('Sovereign AI history fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch conversation history' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId') || 'anonymous'

    const ai = getSovereignAI()
    ai.clearHistory(userId)

    return NextResponse.json({
      success: true,
      message: 'Conversation history cleared'
    })

  } catch (error) {
    console.error('Sovereign AI history clear error:', error)
    return NextResponse.json(
      { error: 'Failed to clear conversation history' },
      { status: 500 }
    )
  }
}
