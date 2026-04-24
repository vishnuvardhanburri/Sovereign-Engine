'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Loader2, Send, Bot, User, Trash2, Lightbulb } from 'lucide-react'
import { toast } from 'sonner'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  actions?: Array<{
    type: string
    description: string
    priority: 'high' | 'medium' | 'low'
  }>
  suggestedCommands?: string[]
}

interface XaviraAIResponse {
  response: string
  actions: Array<{
    type: string
    data: Record<string, unknown>
    priority: 'high' | 'medium' | 'low'
    description: string
  }>
  confidence: number
  suggestedCommands?: string[]
  metadata: {
    model: string
    tokensUsed: number
    cost: number
    processingTime: number
  }
}

export function XaviraAIChat() {
  const [messages, setMessages] = useState<Message[]>(() => {
    const welcomeMessage: Message = {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hi. I can help you manage outbound campaigns:\n\n" +
        "- Create and manage campaigns\n" +
        "- Segment and review contacts\n" +
        "- Draft template-based messages\n" +
        "- Check spam and compliance\n" +
        "- Review performance metrics\n\n" +
        "What do you want to do?",
      timestamp: new Date(),
      suggestedCommands: [
        'Create a new campaign for tech startups',
        'Analyze my contact list',
        'Generate email content for SaaS products',
        'Check content for spam',
        'Show campaign performance',
      ],
    }
    return [welcomeMessage]
  })
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [messages])

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || isLoading) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageText,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/xavira-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: messageText,
          context: {
            currentCampaign: null,
            currentContacts: [],
            recentActions: messages.slice(-3).map(m => m.content)
          }
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get AI response')
      }

      const data = await response.json()
      const aiResponse: XaviraAIResponse = data.data

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: aiResponse.response,
        timestamp: new Date(),
        actions: aiResponse.actions,
        suggestedCommands: aiResponse.suggestedCommands
      }

      setMessages(prev => [...prev, assistantMessage])

      // Show cost information
      if (aiResponse.metadata.cost > 0) {
        toast.success(`AI Response: $${aiResponse.metadata.cost.toFixed(4)} (${aiResponse.metadata.tokensUsed} tokens)`)
      }

    } catch (error) {
      console.error('AI chat error:', error)
      toast.error('Failed to get AI response. Please try again.')

      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: "I apologize, but I encountered an error processing your request. Please try again or rephrase your question.",
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleSuggestedCommand = (command: string) => {
    setInput(command)
    inputRef.current?.focus()
  }

  const clearHistory = async () => {
    try {
      await fetch('/api/xavira-ai?userId=anonymous', {
        method: 'DELETE',
      })
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: "Conversation history cleared! How can I help you with your cold email campaigns today?",
        timestamp: new Date(),
        suggestedCommands: [
          "Create a new campaign",
          "Analyze contacts",
          "Generate content",
          "Check for spam",
          "Scrape contacts"
        ]
      }])
      toast.success('Conversation history cleared')
    } catch {
      toast.error('Failed to clear history')
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'destructive'
      case 'medium': return 'default'
      case 'low': return 'secondary'
      default: return 'secondary'
    }
  }

  return (
    <Card className="w-full max-w-4xl mx-auto h-[600px] flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-500" />
          Xavira AI Assistant
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={clearHistory}
          className="flex items-center gap-2"
        >
          <Trash2 className="h-4 w-4" />
          Clear History
        </Button>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0">
        <ScrollArea className="flex-1 px-4" ref={scrollAreaRef}>
          <div className="space-y-4 py-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`flex gap-2 max-w-[80%] ${
                    message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      message.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-green-500 text-white'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div
                      className={`rounded-lg px-3 py-2 ${
                        message.role === 'user'
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <div className="whitespace-pre-wrap text-sm">
                        {message.content}
                      </div>
                    </div>

                    {/* Actions */}
                    {message.actions && message.actions.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-gray-500 font-medium">Suggested Actions:</div>
                        {message.actions.map((action, index) => (
                          <Badge
                            key={index}
                            variant={getPriorityColor(action.priority)}
                            className="text-xs cursor-pointer hover:opacity-80"
                            onClick={() => toast.info(`Action: ${action.description}`)}
                          >
                            {action.description}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Suggested Commands */}
                    {message.suggestedCommands && message.suggestedCommands.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                          <Lightbulb className="h-3 w-3" />
                          Try these:
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {message.suggestedCommands.map((command, index) => (
                            <Badge
                              key={index}
                              variant="outline"
                              className="text-xs cursor-pointer hover:bg-gray-100"
                              onClick={() => handleSuggestedCommand(command)}
                            >
                              {command}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-2 max-w-[80%]">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="bg-gray-100 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-gray-600">Thinking...</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything about your cold email campaigns..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="flex items-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}
