// @ts-nocheck
'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Mic, MicOff, VolumeX } from 'lucide-react'
import { provideAICoaching } from '@/lib/sovereign-ai-pro'

interface VoiceAssistantProps {
  onCommand: (command: string) => void
  onResponse: (response: string) => void
  context?: Record<string, any>
}

export function VoiceAssistant({ onCommand, onResponse, context }: VoiceAssistantProps) {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [isSupported] = useState(() => {
    if (typeof window === 'undefined') return false
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && Boolean(window.speechSynthesis)
  })
  
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)

  function speakResponse(text: string) {
    if (!synthRef.current) return

    setIsSpeaking(true)
    
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.9
    utterance.pitch = 1
    utterance.volume = 0.8

    utterance.onend = () => {
      setIsSpeaking(false)
    }

    utterance.onerror = () => {
      setIsSpeaking(false)
    }

    synthRef.current.speak(utterance)
  }

  async function handleVoiceCommand(command: string) {
    setTranscript('')
    onCommand(command)

    try {
      const coaching = await provideAICoaching(
        command,
        context || {},
        []
      )

      speakResponse(coaching.coaching)
      onResponse(coaching.coaching)

      if (coaching.nextBestActions.length > 0) {
        const actionResponse = `I suggest you ${coaching.nextBestActions[0].toLowerCase()}`
        setTimeout(() => speakResponse(actionResponse), 2000)
      }
    } catch (error) {
      console.error('Voice command processing error:', error)
      const errorMessage = 'Sorry, I had trouble processing that command.'
      speakResponse(errorMessage)
      onResponse(errorMessage)
    }
  }

  useEffect(() => {
    // Check for browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const SpeechSynthesis = window.speechSynthesis

    if (SpeechRecognition && SpeechSynthesis) {
      // Initialize speech recognition
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = false
      recognitionRef.current.interimResults = true
      recognitionRef.current.lang = 'en-US'

      recognitionRef.current.onstart = () => {
        setIsListening(true)
      }

      recognitionRef.current.onresult = (event) => {
        const current = event.resultIndex
        const transcript = event.results[current][0].transcript
        setTranscript(transcript)
        
        if (event.results[current].isFinal) {
          handleVoiceCommand(transcript)
        }
      }

      recognitionRef.current.onend = () => {
        setIsListening(false)
      }

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
        setIsListening(false)
      }

      // Initialize speech synthesis
      synthRef.current = SpeechSynthesis
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
      if (synthRef.current) {
        synthRef.current.cancel()
      }
    }
  }, [])

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      recognitionRef.current.start()
    }
  }

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop()
    }
  }

  const stopSpeaking = () => {
    if (synthRef.current) {
      synthRef.current.cancel()
      setIsSpeaking(false)
    }
  }

  if (!isSupported) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MicOff className="h-5 w-5" />
            Voice Assistant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Voice features are not supported in this browser. Try Chrome or Edge for the best experience.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isListening ? (
            <Mic className="h-5 w-5 text-red-500 animate-pulse" />
          ) : (
            <MicOff className="h-5 w-5" />
          )}
          Voice Assistant
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            onClick={isListening ? stopListening : startListening}
            variant={isListening ? "destructive" : "default"}
            size="sm"
            className="flex-1"
          >
            {isListening ? 'Stop Listening' : 'Start Listening'}
          </Button>
          
          {isSpeaking && (
            <Button
              onClick={stopSpeaking}
              variant="outline"
              size="sm"
            >
              <VolumeX className="h-4 w-4" />
            </Button>
          )}
        </div>

        {transcript && (
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium">You said:</p>
            <p className="text-sm text-muted-foreground">{transcript}</p>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Try saying: "Create a new campaign" or "Show me analytics" or "Help me optimize"
        </div>
      </CardContent>
    </Card>
  )
}

// Extend window interface for TypeScript
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition
    webkitSpeechRecognition: typeof SpeechRecognition
    speechSynthesis: SpeechSynthesis
  }
}
