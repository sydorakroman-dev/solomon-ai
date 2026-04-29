'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type') as 'invite' | 'recovery' | null

    if (tokenHash && type) {
      // OTP / token_hash flow — verify token directly
      supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
        if (error) {
          setVerifyError(error.message)
        } else {
          window.history.replaceState({}, '', '/auth/reset-password')
          setReady(true)
        }
      })
      return
    }

    // No token in query params — check for an existing session or wait for
    // the browser Supabase client to process an access_token from the URL hash
    // (implicit flow: Supabase puts access_token in the # fragment)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true)
        return
      }

      // Listen for SIGNED_IN fired when the browser client processes the hash
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
          subscription.unsubscribe()
          window.history.replaceState({}, '', '/auth/reset-password')
          setReady(true)
        }
      })

      // Show an error after 5 s if no session arrives
      const timer = setTimeout(() => {
        subscription.unsubscribe()
        setVerifyError('This invite link is invalid or has expired. Please ask your admin to send a new invite.')
      }, 5000)

      return () => {
        clearTimeout(timer)
        subscription.unsubscribe()
      }
    })
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      toast.error('Passwords do not match')
      return
    }
    setLoading(true)
    const supabase = createClient()
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      toast.success('Password set. You are now signed in.')
      router.replace('/dashboard')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set password')
    } finally {
      setLoading(false)
    }
  }

  if (verifyError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Solomon</h1>
          </div>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="text-sm text-destructive">{verifyError}</p>
              <Button variant="outline" className="w-full" onClick={() => router.replace('/login')}>
                Back to sign in
              </Button>
            </CardContent>
          </Card>
        </div>
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
            <CardTitle className="text-lg">Set your password</CardTitle>
            <CardDescription>Choose a password to activate your account</CardDescription>
          </CardHeader>
          <CardContent>
            {!ready ? (
              <p className="text-sm text-muted-foreground text-center py-4">Verifying invite link…</p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    placeholder="••••••••"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Saving…' : 'Set password & sign in'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
