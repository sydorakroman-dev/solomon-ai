import { createClient, createAdminClient } from '@/lib/supabase/server'
import ProjectCard from '@/components/project/ProjectCard'
import CreateProjectDialog from '@/components/project/CreateProjectDialog'
import type { Project } from '@/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const adminClient = await createAdminClient()

  // Owned projects + member projects via admin client to bypass RLS
  const [{ data: ownedProjects }, { data: memberships }] = await Promise.all([
    adminClient.from('projects').select('*').eq('user_id', user!.id),
    adminClient.from('project_members').select('project_id').eq('user_id', user!.id),
  ])

  const ownedIds = new Set((ownedProjects ?? []).map((p: Project) => p.id))
  const memberIds = (memberships ?? [])
    .map((m: { project_id: string }) => m.project_id)
    .filter((id: string) => !ownedIds.has(id))

  let sharedProjects: Project[] = []
  if (memberIds.length > 0) {
    const { data } = await adminClient.from('projects').select('*').in('id', memberIds)
    sharedProjects = (data ?? []) as Project[]
  }

  const projects = [...(ownedProjects ?? []) as Project[], ...sharedProjects]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {projects?.length ?? 0} project{projects?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <CreateProjectDialog />
      </div>

      {!projects?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="font-semibold text-lg">No projects yet</h3>
          <p className="text-muted-foreground text-sm mt-1 mb-6">
            Create your first project to start generating requirements
          </p>
          <CreateProjectDialog />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(projects as Project[]).map(project => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}
