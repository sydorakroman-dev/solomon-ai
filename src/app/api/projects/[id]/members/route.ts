import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify access (owner or member — RLS handles this)
  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', id)
    .single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = project.user_id === user.id

  const adminClient = await createAdminClient()

  // Fetch members + invitations in parallel
  const [{ data: members }, { data: invitations }, { data: { users: authUsers } }] =
    await Promise.all([
      adminClient.from('project_members').select('*').eq('project_id', id).order('created_at'),
      adminClient.from('project_invitations').select('*').eq('project_id', id).eq('status', 'pending').order('created_at'),
      adminClient.auth.admin.listUsers({ perPage: 1000 }),
    ])

  // Fetch profiles for name lookups
  const memberUserIds = (members ?? []).map((m: { user_id: string }) => m.user_id)
  const { data: profiles } = memberUserIds.length
    ? await adminClient.from('profiles').select('user_id, full_name').in('user_id', memberUserIds)
    : { data: [] }

  const emailMap = new Map(authUsers.map((u: { id: string; email?: string }) => [u.id, u.email ?? '']))
  const nameMap = new Map((profiles ?? []).map((p: { user_id: string; full_name: string | null }) => [p.user_id, p.full_name]))

  const enrichedMembers = (members ?? []).map((m: { user_id: string; [key: string]: unknown }) => ({
    ...m,
    email: emailMap.get(m.user_id) ?? '',
    name: nameMap.get(m.user_id) ?? null,
  }))

  return NextResponse.json({ isOwner, members: enrichedMembers, invitations: invitations ?? [] })
}
