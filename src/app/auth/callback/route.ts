import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/dashboard'

  // Traefik sets x-forwarded-host to the real public hostname.
  // Fall back to env var or hardcoded domain so internal Docker hostnames
  // never appear in redirects.
  const forwardedHost = request.headers.get('x-forwarded-host')
  const origin = forwardedHost
    ? `https://${forwardedHost}`
    : (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
        ?? process.env.APP_URL?.replace(/\/$/, '')
        ?? 'https://solomon.quitcode.com')

  // Invite / password-reset: forward token to the client-side page so the
  // browser Supabase client handles OTP verification and session storage.
  if (tokenHash && type) {
    if (type === 'invite' || type === 'recovery') {
      const params = new URLSearchParams({ token_hash: tokenHash, type })
      return NextResponse.redirect(`${origin}/auth/reset-password?${params}`)
    }
    // Other OTP types (e.g. email_change) — verify server-side
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'email_change' })
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }

  // PKCE code exchange flow
  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }

  return NextResponse.redirect(`${origin}/login`)
}
