import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncPrdToGitHub } from '@/lib/github-sync'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  const { data: prd } = await supabase.from('prd').select('project_id').eq('id', id).single()
  if (!prd) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects').select('id').eq('id', prd.project_id).eq('user_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('prd')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (body.status === 'approved') {
    await supabase
      .from('projects')
      .update({ status: 'epics' })
      .eq('id', prd.project_id)
      .eq('user_id', user.id)
      .eq('status', 'prd')
  }

  const syncResult = await syncPrdToGitHub(prd.project_id)
  return NextResponse.json({ ...data, ...syncResult })
}
