// src/app/api/projects/[id]/github/sync/route.ts
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  GitHubError,
  pushFile,
  createMilestone,
  updateMilestone,
  createIssue,
  updateIssue,
  formatStoryBody,
} from '@/lib/github'
import { repoNameFromUrl } from '@/lib/github-sync'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only project owner can trigger full sync
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, github_repo_url')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!project.github_repo_url) {
    return NextResponse.json({ error: 'Project not exported to GitHub yet' }, { status: 400 })
  }

  const repoFullName = repoNameFromUrl(project.github_repo_url)

  const adminClient = await createAdminClient()
  const { data: ownerProfile } = await adminClient
    .from('profiles')
    .select('github_access_token')
    .eq('user_id', project.user_id)
    .single()
  const token = ownerProfile?.github_access_token
  if (!token) {
    return NextResponse.json(
      { error: 'GitHub connection lost. Reconnect in your Profile.' },
      { status: 400 }
    )
  }

  try {
    // Sync PRD
    const { data: prd } = await supabase
      .from('prd')
      .select('id, content, github_file_sha')
      .eq('project_id', id)
      .single()
    if (prd?.content) {
      const { sha } = await pushFile(
        token, repoFullName, 'docs/PRD.md', prd.content, prd.github_file_sha ?? undefined
      )
      await supabase.from('prd').update({ github_file_sha: sha }).eq('id', prd.id)
    }

    // Sync epics
    const { data: epics } = await supabase
      .from('epics')
      .select('id, code, title, description, github_milestone_number')
      .eq('project_id', id)
      .order('order')
    for (const epic of epics ?? []) {
      const title = `${epic.code}: ${epic.title}`
      const description = epic.description ?? ''
      if (epic.github_milestone_number) {
        await updateMilestone(token, repoFullName, epic.github_milestone_number, title, description)
      } else {
        const m = await createMilestone(token, repoFullName, title, description)
        await supabase.from('epics').update({ github_milestone_number: m.number }).eq('id', epic.id)
      }
    }

    // Reload epics for milestone map
    const { data: epicsRefreshed } = await supabase
      .from('epics')
      .select('id, github_milestone_number')
      .eq('project_id', id)
    const milestoneMap = Object.fromEntries(
      (epicsRefreshed ?? []).map(e => [e.id, e.github_milestone_number as number | null])
    )

    // Sync stories
    const { data: stories } = await supabase
      .from('user_stories')
      .select('id, code, title, as_a, i_want, so_that, epic_id, github_issue_number')
      .eq('project_id', id)
      .order('order')
    for (const story of stories ?? []) {
      const title = `${story.code}: ${story.title}`
      const body = formatStoryBody(story.as_a, story.i_want, story.so_that)
      const milestone = story.epic_id ? milestoneMap[story.epic_id] ?? undefined : undefined
      if (story.github_issue_number) {
        await updateIssue(token, repoFullName, story.github_issue_number, title, body)
      } else {
        const issue = await createIssue(token, repoFullName, title, body, milestone)
        await supabase.from('user_stories').update({ github_issue_number: issue.number }).eq('id', story.id)
      }
    }

    await supabase
      .from('projects')
      .update({ github_sync_error: null, github_exported_at: new Date().toISOString() })
      .eq('id', id)

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof GitHubError ? err.message : 'Sync failed'
    if (err instanceof GitHubError && err.status === 401) {
      await adminClient
        .from('profiles')
        .update({ github_access_token: null, github_username: null, github_connected_at: null })
        .eq('user_id', project.user_id)
    }
    await supabase.from('projects').update({ github_sync_error: message }).eq('id', id)
    const status = err instanceof GitHubError ? err.status : 500
    return NextResponse.json({ error: message }, { status })
  }
}
