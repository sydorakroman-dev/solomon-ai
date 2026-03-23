import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'GitHub OAuth not configured' }, { status: 500 })

  const appUrl = process.env.APP_URL ?? 'https://solomon.quitcode.com'
  const redirectUri = encodeURIComponent(`${appUrl}/api/auth/github/callback`)
  const scope = encodeURIComponent('repo')
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`
  return NextResponse.redirect(url)
}

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await supabase
    .from('profiles')
    .update({ github_access_token: null, github_username: null, github_connected_at: null })
    .eq('user_id', user.id)

  return NextResponse.json({ success: true })
}
