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
  const [verifying, setVerifying] = useState(false)
  const [ready, setReady] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  useEffect(() => {
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type') as 'invite' | 'recovery' | null

    if (!tokenHash || !type) {
      // Arrived here after a server-side session (e.g. password reset email).
      setReady(true)
      return
    }

    setVerifying(true)
    const supabase = createClient()
    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
      setVerifying(false)
      if (error) {
        setVerifyError(error.message)
      } else {
        // Clean token params from the URL without a page reload.
        window.history.replaceState({}, '', '/auth/reset-password')
        setReady(true)
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Solomon</h1>
          <p className="mt-1 text-sm text-muted-foreground">Requirements engineering for PMs</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Set new password</CardTitle>
            <CardDescription>Choose a password for your account</CardDescription>
          </CardHeader>
          <CardContent>
            {verifying && (
              <p className="text-sm text-muted-foreground text-center py-4">Verifying your invite link…</p>
            )}

            {verifyError && (
              <div className="space-y-3">
                <p className="text-sm text-destructive">
                  This invite link is invalid or has expired. Please ask your admin to send a new invite.
                </p>
                <Button variant="outline" className="w-full" onClick={() => router.replace('/login')}>
                  Back to sign in
                </Button>
              </div>
            )}

            {ready && (
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
                  <Label htmlFor="confirm">Confirm new password</Label>
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
                  {loading ? 'Saving…' : 'Set password'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
