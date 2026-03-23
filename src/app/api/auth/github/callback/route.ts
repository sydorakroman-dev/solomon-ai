import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGitHubUser } from '@/lib/github'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) return NextResponse.redirect(`${origin}/profile?error=github_auth_failed`)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const tokenData = await tokenRes.json() as { access_token?: string }
  const accessToken = tokenData.access_token
  if (!accessToken) return NextResponse.redirect(`${origin}/profile?error=github_auth_failed`)

  // Get GitHub username
  let githubUsername: string
  try {
    const githubUser = await getGitHubUser(accessToken)
    githubUsername = githubUser.login
  } catch {
    return NextResponse.redirect(`${origin}/profile?error=github_auth_failed`)
  }

  // Save to profiles
  await supabase
    .from('profiles')
    .update({
      github_access_token: accessToken,
      github_username: githubUsername,
      github_connected_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  return NextResponse.redirect(`${origin}/profile?github=connected`)
}
