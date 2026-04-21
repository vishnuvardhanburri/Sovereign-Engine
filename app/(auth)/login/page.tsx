'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { user, login } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (user) {
      router.push('/dashboard')
    }
  }, [user, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || !password) {
      toast.error('Please fill in all fields')
      return
    }

    setIsLoading(true)
    try {
      await login(email, password)
      toast.success('Login successful!')
    } catch (error) {
      toast.error('Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center space-y-3">
          <div className="w-14 h-14 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-base">
            XO
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white">Xavira Orbit</h1>
            <p className="text-slate-300 text-sm mt-2">Outbound Infrastructure for Scalable Lead Generation</p>
          </div>
        </div>

        {/* Login Card */}
        <Card className="border-slate-700 bg-slate-900">
          <CardHeader className="space-y-2">
            <CardTitle>Sign in to your workspace</CardTitle>
            <CardDescription>
              Access your outbound infrastructure dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="demo@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="bg-slate-800 border-slate-700"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="bg-slate-800 border-slate-700"
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={isLoading}
              >
                {isLoading ? 'Signing in...' : 'Sign in'}
              </Button>

              <Link
                href="/demo"
                className="block text-center text-sm text-slate-200 underline underline-offset-4 hover:text-white"
              >
                Book a demo
              </Link>
            </form>

            <div className="mt-6 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
              <p className="text-xs text-slate-300 font-medium">Trusted by teams who care about deliverability</p>
              <p className="text-xs text-slate-400 mt-2">
                You own the infrastructure. Xavira Orbit runs a queue + worker system with strict stop-on-reply and suppression enforcement.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
