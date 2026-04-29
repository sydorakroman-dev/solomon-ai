import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get project IDs the user is an explicit member of
  const { data: memberships } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', user.id)

  const memberProjectIds = (memberships ?? []).map((m: { project_id: string }) => m.project_id)

  const adminClient = await createAdminClient()

  // Owned projects
  const { data: ownedProjects, error } = await adminClient
    .from('projects')
    .select('*')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Member projects (not already owned)
  const ownedIds = new Set((ownedProjects ?? []).map((p: { id: string }) => p.id))
  let sharedProjects: unknown[] = []
  if (memberProjectIds.length > 0) {
    const { data } = await adminClient
      .from('projects')
      .select('*')
      .in('id', memberProjectIds.filter((id: string) => !ownedIds.has(id)))
    sharedProjects = data ?? []
  }

  const allProjects = [...(ownedProjects ?? []), ...sharedProjects]
    .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  return NextResponse.json(allProjects)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, client_name, industry, type, mode } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: name.trim(),
      client_name: client_name?.trim() || null,
      industry: industry?.trim() || null,
      type: type ?? 'greenfield',
      mode: mode ?? 'epics_and_stories',
      status: 'setup',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
