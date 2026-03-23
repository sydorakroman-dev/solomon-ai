import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncStoryToGitHub } from '@/lib/github-sync'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { data, error } = await supabase
    .from('user_stories').update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select('*, project_id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const syncResult = await syncStoryToGitHub(id, data.project_id as string)
  return NextResponse.json({ ...data, ...syncResult })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('user_stories').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
