// src/app/api/projects/[id]/github/init/route.ts
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  GitHubError,
  slugifyRepoName,
  createRepo,
  pushFile,
  createMilestone,
  createIssue,
  formatStoryBody,
} from '@/lib/github'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only project owner can export
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, user_id, github_repo_url')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Get owner's GitHub token
  const adminClient = await createAdminClient()
  const { data: ownerProfile } = await adminClient
    .from('profiles')
    .select('github_access_token')
    .eq('user_id', project.user_id)
    .single()
  const token = ownerProfile?.github_access_token
  if (!token) {
    return NextResponse.json(
      { error: 'GitHub account not connected. Connect GitHub in your Profile first.' },
      { status: 400 }
    )
  }

  const body = await request.json() as { repoName?: string; isPrivate?: boolean }
  const repoName = body.repoName?.trim() || slugifyRepoName(project.name)
  const isPrivate = body.isPrivate ?? false

  try {
    let repoFullName: string
    let repoUrl: string

    if (project.github_repo_url) {
      // Partial export — reuse existing repo
      repoUrl = project.github_repo_url
      repoFullName = repoUrl.replace('https://github.com/', '').replace(/\/$/, '')
    } else {
      // Create new repo
      const repo = await createRepo(token, repoName, isPrivate)
      repoFullName = repo.full_name
      repoUrl = repo.html_url
      // Save immediately so partial retry works
      await supabase.from('projects').update({ github_repo_url: repoUrl }).eq('id', id)
    }

    // Push PRD (if content exists)
    const { data: prd } = await supabase
      .from('prd')
      .select('id, content, github_file_sha')
      .eq('project_id', id)
      .single()
    if (prd?.content) {
      const { sha } = await pushFile(
        token,
        repoFullName,
        'docs/PRD.md',
        prd.content,
        prd.github_file_sha ?? undefined,
        'docs: add PRD'
      )
      await supabase.from('prd').update({ github_file_sha: sha }).eq('id', prd.id)
    }

    // Create milestones for epics that don't have one yet
    const { data: epics } = await supabase
      .from('epics')
      .select('id, code, title, description, github_milestone_number')
      .eq('project_id', id)
      .order('order')
    for (const epic of epics ?? []) {
      if (epic.github_milestone_number) continue
      const milestone = await createMilestone(
        token,
        repoFullName,
        `${epic.code}: ${epic.title}`,
        epic.description ?? ''
      )
      await supabase.from('epics').update({ github_milestone_number: milestone.number }).eq('id', epic.id)
    }

    // Reload epics with milestone numbers for story assignment
    const { data: epicsWithNumbers } = await supabase
      .from('epics')
      .select('id, github_milestone_number')
      .eq('project_id', id)
    const milestoneMap = Object.fromEntries(
      (epicsWithNumbers ?? []).map(e => [e.id, e.github_milestone_number as number | null])
    )

    // Create issues for stories that don't have one yet
    const { data: stories } = await supabase
      .from('user_stories')
      .select('id, code, title, as_a, i_want, so_that, epic_id, github_issue_number')
      .eq('project_id', id)
      .order('order')
    for (const story of stories ?? []) {
      if (story.github_issue_number) continue
      const milestone = story.epic_id ? milestoneMap[story.epic_id] ?? undefined : undefined
      const issue = await createIssue(
        token,
        repoFullName,
        `${story.code}: ${story.title}`,
        formatStoryBody(story.as_a, story.i_want, story.so_that),
        milestone
      )
      await supabase.from('user_stories').update({ github_issue_number: issue.number }).eq('id', story.id)
    }

    // Mark export complete
    await supabase
      .from('projects')
      .update({ github_exported_at: new Date().toISOString(), github_sync_error: null })
      .eq('id', id)

    return NextResponse.json({ repoUrl })
  } catch (err) {
    const message = err instanceof GitHubError ? err.message : 'Failed to export to GitHub'
    await supabase.from('projects').update({ github_sync_error: message }).eq('id', id)
    const status = err instanceof GitHubError && err.status === 422 ? 422 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
