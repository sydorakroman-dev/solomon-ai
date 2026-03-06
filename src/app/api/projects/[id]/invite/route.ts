import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { MemberRole } from '@/types'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only project owner can invite
  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, role } = await request.json() as { email: string; role: MemberRole }
  if (!email || !role) return NextResponse.json({ error: 'email and role required' }, { status: 400 })
  if (!['viewer', 'editor'].includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const normalizedEmail = email.trim().toLowerCase()
  const adminClient = await createAdminClient()

  // Check if user exists in auth
  const { data: { users: allUsers } } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
  const existing = allUsers.find((u: { email?: string }) => u.email?.toLowerCase() === normalizedEmail)

  if (existing) {
    // User exists — add directly to project_members
    const { error } = await adminClient.from('project_members').upsert(
      { project_id: id, user_id: existing.id, role, invited_by: user.id },
      { onConflict: 'project_id,user_id' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: 'added', email: normalizedEmail })
  }

  // User doesn't exist — create invitation + send Supabase invite email
  const { error: inviteError } = await adminClient.from('project_invitations').upsert(
    { project_id: id, email: normalizedEmail, role, invited_by: user.id, status: 'pending' },
    { onConflict: 'project_id,email' }
  )
  if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
    redirectTo: `${appUrl}/dashboard`,
  })

  return NextResponse.json({ status: 'invited', email: normalizedEmail })
}
