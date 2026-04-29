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

  // Get all profiles
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('user_id, role, full_name, created_at')
    .order('created_at', { ascending: false })

  // Get auth users to get emails
  const { data: { users: authUsers } } = await adminClient.auth.admin.listUsers()

  const emailMap = new Map(authUsers.map(u => [u.id, u.email]))

  const users = (profiles ?? []).map(p => ({
    ...p,
    email: emailMap.get(p.user_id) ?? 'unknown',
  }))

  return NextResponse.json(users)
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { email } = await request.json()
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://solomon.quitcode.com'
  const adminClient = await createAdminClient()
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email.trim(), {
    redirectTo: `${appUrl}/auth/callback?next=/auth/reset-password`,
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
    .update({ role })
    .eq('user_id', user_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
