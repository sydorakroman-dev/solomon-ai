import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // RLS handles access: returns data only if user is owner OR project_member
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', id)
    .single()

  if (!project) {
    // Project not found — could be a pending invitation. Accept it and retry once.
    if (user.email) {
      try {
        const adminClient = await createAdminClient()
        const { data: invite } = await adminClient
          .from('project_invitations')
          .select('id, role')
          .eq('project_id', id)
          .eq('email', user.email)
          .eq('status', 'pending')
          .single()

        if (invite) {
          await adminClient.from('project_members').upsert(
            { project_id: id, user_id: user.id, role: invite.role },
            { onConflict: 'project_id,user_id' }
          )
          await adminClient
            .from('project_invitations')
            .update({ status: 'accepted' })
            .eq('id', invite.id)

          // Re-check access now that the invitation is accepted
          const { data: retryProject } = await supabase
            .from('projects')
            .select('id')
            .eq('id', id)
            .single()

          if (!retryProject) notFound()
        } else {
          notFound()
        }
      } catch {
        notFound()
      }
    } else {
      notFound()
    }
  }

  return <>{children}</>
}
