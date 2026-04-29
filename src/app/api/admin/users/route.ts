import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('user_id', user.id).single()
  if (profile?.role !== 'admin') return null

  return user
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const adminClient = await createAdminClient()

  // Auth users is the source of truth — profiles may not exist yet for
  // invited users who haven't completed setup.
  const { data: { users: authUsers } } = await adminClient.auth.admin.listUsers()

  const { data: profiles } = await adminClient
    .from('profiles')
    .select('user_id, role, full_name, created_at')

  const profileMap = new Map((profiles ?? []).map(p => [p.user_id, p]))

  const users = authUsers.map(u => {
    const profile = profileMap.get(u.id)
    return {
      user_id: u.id,
      email: u.email ?? 'unknown',
      role: (profile?.role ?? 'user') as 'admin' | 'user',
      full_name: profile?.full_name ?? null,
      created_at: profile?.created_at ?? u.created_at,
    }
  }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return NextResponse.json(users)
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { email } = await request.json()
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  // Derive the public URL from Traefik's x-forwarded-host header so that
  // APP_URL=http://localhost:3000 in the server .env never pollutes the
  // Supabase redirectTo (which must be a whitelisted public URL).
  const forwardedHost = request.headers.get('x-forwarded-host')
  const appUrl = forwardedHost
    ? `https://${forwardedHost}`
    : 'https://solomon.quitcode.com'

  const adminClient = await createAdminClient()
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email.trim(), {
    redirectTo: `${appUrl}/auth/reset-password`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ user_id: data.user.id, email: data.user.email })
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { user_id, role } = await request.json()
  if (!user_id || !role) return NextResponse.json({ error: 'user_id and role required' }, { status: 400 })
  if (!['admin', 'user'].includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const adminClient = await createAdminClient()
  const { data, error } = await adminClient
    .from('profiles')
    .upsert({ user_id, role }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
