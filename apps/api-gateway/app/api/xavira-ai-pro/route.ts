import { NextRequest, NextResponse } from 'next/server'
import { 
  predictEmailPerformance,
  createAutonomousCampaign,
  optimizeCampaign,
  generateSmartPersonalization,
  analyzeCompetitiveLandscape,
  provideAICoaching,
  predictLeadConversion
} from '@/lib/xavira-ai-pro'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, ...params } = body

    switch (action) {
      case 'predict_performance':
        const prediction = await predictEmailPerformance(
          params.subject,
          params.content,
          params.recipientProfile,
          params.campaignHistory
        )
        return NextResponse.json({ success: true, data: prediction })

      case 'create_autonomous_campaign':
        const campaign = await createAutonomousCampaign(params.campaignId, params.config)
        return NextResponse.json({ success: true, data: campaign })

      case 'optimize_campaign':
        const optimizations = await optimizeCampaign(params.campaignId, params.metrics)
        return NextResponse.json({ success: true, data: optimizations })

      case 'smart_personalization':
        const personalization = await generateSmartPersonalization(
          params.recipientData,
          params.campaignContext
        )
        return NextResponse.json({ success: true, data: personalization })

      case 'competitive_intelligence':
        const intelligence = await analyzeCompetitiveLandscape(
          params.industry,
          params.targetMarket,
          params.strategy
        )
        return NextResponse.json({ success: true, data: intelligence })

      case 'ai_coaching':
        const coaching = await provideAICoaching(
          params.userAction,
          params.context,
          params.history
        )
        return NextResponse.json({ success: true, data: coaching })

      case 'predict_conversion':
        const conversion = await predictLeadConversion(
          params.leadData,
          params.campaignHistory,
          params.marketData
        )
        return NextResponse.json({ success: true, data: conversion })

      default:
        return NextResponse.json(
          { success: false, error: 'Unknown action' },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Xavira AI Pro API error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
