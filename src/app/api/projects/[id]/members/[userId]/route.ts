import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string; userId: string }> }

async function requireOwner(projectId: string, callerId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .eq('user_id', callerId)
    .single()
  return !!data
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, userId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await requireOwner(id, user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { role } = await request.json()
  if (!['viewer', 'editor'].includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const adminClient = await createAdminClient()
  const { data, error } = await adminClient
    .from('project_members')
    .update({ role })
    .eq('project_id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, userId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await requireOwner(id, user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const adminClient = await createAdminClient()
  const { error } = await adminClient
    .from('project_members')
    .delete()
    .eq('project_id', id)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
