'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Progress } from './ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { 
  Brain, 
  TrendingUp, 
  Zap, 
  Mic, 
  Target, 
  BarChart3, 
  Play, 
  Pause, 
  Settings,
  Sparkles
} from 'lucide-react'
import { VoiceAssistant } from './voice-assistant'
import { predictEmailPerformance, getOptimizationStats } from '@/lib/sovereign-ai-pro'
import { startAutonomousOptimization, stopAutonomousOptimization } from '@/lib/autonomous-optimizer'

interface DashboardStats {
  activeCampaigns: number
  totalOptimizations: number
  averageImprovement: number
  topPerformingCampaigns: string[]
}

export function NextLevelDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [voiceCommands, setVoiceCommands] = useState<string[]>([])
  const [predictions, setPredictions] = useState<any[]>([])

  const loadDashboardData = async () => {
    try {
      const optimizationStats = await getOptimizationStats()
      setStats(optimizationStats)
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    }
  }

  useEffect(() => {
    loadDashboardData()
    const interval = setInterval(loadDashboardData, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])

  const handleStartOptimization = async () => {
    try {
      await startAutonomousOptimization()
      setIsOptimizing(true)
    } catch (error) {
      console.error('Failed to start optimization:', error)
    }
  }

  const handleStopOptimization = async () => {
    try {
      stopAutonomousOptimization()
      setIsOptimizing(false)
    } catch (error) {
      console.error('Failed to stop optimization:', error)
    }
  }

  const handleVoiceCommand = (command: string) => {
    setVoiceCommands(prev => [command, ...prev.slice(0, 9)]) // Keep last 10 commands
  }

  const handleVoiceResponse = (response: string) => {
    console.log('Voice response:', response)
  }

  const runPredictionDemo = async () => {
    const demoData = {
      subject: "Revolutionize Your Development Workflow",
      content: "Hi [Name], I noticed your team is building amazing products. What if you could automate 80% of your repetitive tasks?",
      recipientProfile: {
        industry: "technology",
        companySize: "51-200",
        role: "CTO",
        experience: "senior"
      }
    }

    try {
      const prediction = await predictEmailPerformance(
        demoData.subject,
        demoData.content,
        demoData.recipientProfile
      )
      setPredictions(prev => [prediction, ...prev.slice(0, 4)]) // Keep last 5 predictions
    } catch (error) {
      console.error('Prediction demo failed:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-purple-500" />
            Sovereign Engine Pro
          </h1>
          <p className="text-muted-foreground">
            Next-level autonomous cold email platform with AI-powered optimization
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={isOptimizing ? handleStopOptimization : handleStartOptimization}
            variant={isOptimizing ? "destructive" : "default"}
            size="lg"
          >
            {isOptimizing ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                Stop Autonomous Mode
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Start Autonomous Mode
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.activeCampaigns || 0}</div>
            <p className="text-xs text-muted-foreground">
              Autonomous optimization running
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Optimizations</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalOptimizations || 0}</div>
            <p className="text-xs text-muted-foreground">
              Actions taken this week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Improvement</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats ? `${(stats.averageImprovement * 100).toFixed(1)}%` : '0%'}
            </div>
            <p className="text-xs text-muted-foreground">
              Performance boost
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Predictions</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{predictions.length}</div>
            <p className="text-xs text-muted-foreground">
              Real-time analytics
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="predictions">AI Predictions</TabsTrigger>
          <TabsTrigger value="voice">Voice Control</TabsTrigger>
          <TabsTrigger value="optimization">Optimization</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Autonomous Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Autonomous Mode Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span>Status:</span>
                  <Badge variant={isOptimizing ? "default" : "secondary"}>
                    {isOptimizing ? "Active" : "Inactive"}
                  </Badge>
                </div>
                
                {isOptimizing && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Optimization Progress</span>
                      <span>Running</span>
                    </div>
                    <Progress value={75} className="w-full" />
                  </div>
                )}

                <div className="text-sm text-muted-foreground">
                  Autonomous campaigns automatically optimize send times, subject lines, 
                  content variations, and audience segmentation based on real-time performance data.
                </div>
              </CardContent>
            </Card>

            {/* Top Performing Campaigns */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Top Performing Campaigns
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats?.topPerformingCampaigns?.length ? (
                  <div className="space-y-2">
                    {stats.topPerformingCampaigns.map((campaignId, index) => (
                      <div key={campaignId} className="flex items-center justify-between">
                        <span className="text-sm">{campaignId}</span>
                        <Badge variant="outline">#{index + 1}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No campaign data available yet
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="predictions" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">AI Performance Predictions</h3>
            <Button onClick={runPredictionDemo} size="sm">
              Run Demo Prediction
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {predictions.map((prediction, index) => (
              <Card key={index}>
                <CardHeader>
                  <CardTitle className="text-sm">Prediction #{index + 1}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Open Rate:</span>
                    <span className="font-medium">{(prediction.predictedOpenRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Click Rate:</span>
                    <span className="font-medium">{(prediction.predictedClickRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Reply Rate:</span>
                    <span className="font-medium">{(prediction.predictedReplyRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Confidence:</span>
                    <span className="font-medium">{(prediction.confidence * 100).toFixed(0)}%</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {predictions.length === 0 && (
            <Card>
              <CardContent className="text-center py-8">
                <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  No predictions yet. Click "Run Demo Prediction" to see AI analytics in action.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="voice" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <VoiceAssistant 
              onCommand={handleVoiceCommand}
              onResponse={handleVoiceResponse}
            />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mic className="h-5 w-5" />
                  Recent Voice Commands
                </CardTitle>
              </CardHeader>
              <CardContent>
                {voiceCommands.length > 0 ? (
                  <div className="space-y-2">
                    {voiceCommands.map((command, index) => (
                      <div key={index} className="p-2 bg-muted rounded text-sm">
                        "{command}"
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No voice commands yet. Try speaking to the assistant!
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="optimization" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Autonomous Optimization Engine</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {stats?.totalOptimizations || 0}
                  </div>
                  <p className="text-sm text-muted-foreground">Optimizations Applied</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {stats?.activeCampaigns || 0}
                  </div>
                  <p className="text-sm text-muted-foreground">Active Campaigns</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {stats ? `${(stats.averageImprovement * 100).toFixed(1)}%` : '0%'}
                  </div>
                  <p className="text-sm text-muted-foreground">Average Improvement</p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium">Optimization Features:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Real-time performance monitoring</li>
                  <li>• A/B testing automation</li>
                  <li>• Send time optimization</li>
                  <li>• Content variation testing</li>
                  <li>• Audience segmentation</li>
                  <li>• Predictive scaling</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
