import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ authError: authError?.message, user: null })

  const { data: projects, error: projectsError } = await supabase
    .from('projects')
    .select('id, name, user_id')
    .eq('user_id', user.id)

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    projectsError: projectsError?.message ?? null,
    projectCount: projects?.length ?? 0,
    projects: projects ?? [],
  })
}
