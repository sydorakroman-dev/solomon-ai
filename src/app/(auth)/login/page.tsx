'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin')
  const [redirecting, setRedirecting] = useState(false)

  // Supabase's Site URL is set to /login, so invite and password-reset emails
  // land here with access_token in the URL hash. Extract the tokens, call
  // setSession so they are stored in cookies, then hard-navigate to the
  // reset-password page (no hash needed — getSession will find it in cookies).
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    const params = new URLSearchParams(hash.slice(1))
    const type = params.get('type')
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token') ?? ''
    if ((type === 'invite' || type === 'recovery') && accessToken) {
      setRedirecting(true)
      const supabase = createClient()
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(() => { window.location.replace('/auth/reset-password') })
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.push('/dashboard')
        router.refresh()

      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        })
        if (error) throw error
        toast.success('Account created! Check your email to confirm.')
        setMode('signin')

      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
        })
        if (error) throw error
        toast.success('Password reset email sent. Check your inbox.')
        setMode('signin')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (redirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40">
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Solomon</h1>
          <p className="mt-1 text-sm text-muted-foreground">Requirements engineering for PMs</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}
            </CardTitle>
            <CardDescription>
              {mode === 'signin'
                ? 'Enter your credentials to access your projects'
                : mode === 'signup'
                ? 'Set up your Solomon account'
                : "Enter your email and we'll send a reset link"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {mode !== 'forgot' && (
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading
                  ? 'Loading...'
                  : mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset email'}
              </Button>
            </form>

            <div className="mt-4 flex flex-col items-center gap-1.5 text-sm text-muted-foreground">
              {mode === 'signin' && (
                <>
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                    onClick={() => setMode('forgot')}
                  >
                    Forgot password?
                  </button>
                  <span>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                      onClick={() => setMode('signup')}
                    >
                      Sign up
                    </button>
                  </span>
                </>
              )}
              {mode !== 'signin' && (
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                  onClick={() => setMode('signin')}
                >
                  Back to sign in
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
