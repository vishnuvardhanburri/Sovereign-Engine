import { NextRequest, NextResponse } from 'next/server'
import { createAutonomousCampaign, getCampaignStatus } from '@/lib/agents/intelligence'

/**
 * POST /api/intelligence/campaign
 *
 * Create an autonomous campaign from natural language intent
 *
 * Request:
 * {
 *   "intent": "Target SaaS founders in US with $10M+ revenue"
 * }
 *
 * Response:
 * {
 *   "campaignId": "campaign-1234567890",
 *   "status": "executing",
 *   "progress": {...},
 *   "leadsDiscovered": 500,
 *   "estimatedMetrics": {...}
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { intent } = await req.json()

    if (!intent || typeof intent !== 'string') {
      return NextResponse.json(
        { error: 'Invalid intent parameter' },
        { status: 400 }
      )
    }

    if (intent.length > 200) {
      return NextResponse.json(
        { error: 'Intent too long (max 200 characters)' },
        { status: 400 }
      )
    }

    // Create autonomous campaign
    const campaign = await createAutonomousCampaign(intent)

    return NextResponse.json(
      {
        campaignId: campaign.id,
        status: campaign.status,
        progress: campaign.progress,
        intent: campaign.intent
          ? {
              goal: campaign.intent.goal,
              industries: campaign.intent.icp.industry,
              targetPersonas: campaign.intent.targetPersonas.map((p) => p.role),
              estimatedVolume: campaign.intent.estimatedVolume,
              priority: campaign.intent.priority,
              expectedResponseRate: campaign.intent.successMetrics.responseRateTarget,
            }
          : null,
        discoveredLeads: campaign.discoveredLeads
          ? {
              total: campaign.discoveredLeads.totalDiscovered,
              companies: campaign.discoveredLeads.companies.length,
              avgEngagementScore: campaign.discoveredLeads.avgEngagementScore,
            }
          : null,
        strategy: campaign.strategy
          ? {
              primaryPersona: campaign.strategy.primaryPersona.role,
              messagingAngle: campaign.strategy.primaryAngle.primary,
              touches: campaign.strategy.touchSequence.length,
              expectedResponseRate: campaign.strategy.expectedOutcomes.responseRateTarget,
              expectedConversionRate: campaign.strategy.expectedOutcomes.conversionRate,
            }
          : null,
        segmentation: campaign.segmentedLeads
          ? {
              primaryPersona: campaign.segmentedLeads.primary_persona?.length || 0,
              secondaryPersonas: campaign.segmentedLeads.secondary_personas?.length || 0,
              waitlist: campaign.segmentedLeads.wait_list?.length || 0,
            }
          : null,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[Intelligence API] Campaign creation failed:', error)
    return NextResponse.json(
      { error: 'Failed to create autonomous campaign' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/intelligence/campaign/:campaignId
 *
 * Get campaign status and insights
 */
export async function GET(req: NextRequest, { params }: { params: { campaignId: string } }) {
  try {
    // In production, fetch campaign from database
    // For now, return placeholder
    const campaignId = params?.campaignId

    return NextResponse.json({
      message: 'Use POST to create new autonomous campaign',
      exampleIntents: [
        'Get SaaS founders in US with $5M+ revenue',
        'Target fintech companies in London raising Series A',
        'Find real estate agents in Dubai',
        'Identify marketing directors at B2B tech companies',
      ],
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch campaign' }, { status: 500 })
  }
}
