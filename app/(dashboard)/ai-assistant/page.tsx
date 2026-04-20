import { XaviraAIChat } from '@/components/xavira-ai-chat'

export default function AIAssistantPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Xavira AI Assistant</h1>
        <p className="text-muted-foreground mt-2">
          Your intelligent companion for cold email campaign management.
          Ask me anything about campaigns, contacts, content, or analytics.
        </p>
      </div>

      <XaviraAIChat />
    </div>
  )
}