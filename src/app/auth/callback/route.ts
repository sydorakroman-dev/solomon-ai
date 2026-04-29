import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/dashboard'

  // Use the configured public URL so Docker/reverse-proxy internal hostnames
  // don't leak into redirects.
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
    ?? process.env.APP_URL?.replace(/\/$/, '')
    ?? 'https://solomon.quitcode.com'

  const supabase = await createClient()

  // Invite / password-reset flow (token_hash + type)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'invite' | 'recovery' })
    if (!error) {
      const redirectTo = type === 'invite' || type === 'recovery'
        ? `${origin}/auth/reset-password`
        : `${origin}${next}`
      return NextResponse.redirect(redirectTo)
    }
  }

  // PKCE code exchange flow
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login`)
}
