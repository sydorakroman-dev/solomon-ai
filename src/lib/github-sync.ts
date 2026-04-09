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

export type GitHubSyncResult = { githubSyncError?: string | null }

export function repoNameFromUrl(url: string): string {
  return url.replace('https://github.com/', '').replace(/\/$/, '')
}

async function getOwnerToken(
  projectId: string
): Promise<{ token: string; repoFullName: string } | null> {
  const token = process.env.GITHUB_ACCESS_TOKEN
  if (!token) return null

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo_url')
    .eq('id', projectId)
    .single()
  if (!project?.github_repo_url) return null

  return {
    token,
    repoFullName: repoNameFromUrl(project.github_repo_url),
  }
}

// Use adminClient so these writes succeed regardless of who triggered the save
// (a collaborator's session may not have RLS permission to write project columns).
async function saveError(projectId: string, message: string): Promise<void> {
  const adminClient = await createAdminClient()
  await adminClient.from('projects').update({ github_sync_error: message }).eq('id', projectId)
}

async function clearError(projectId: string): Promise<void> {
  const adminClient = await createAdminClient()
  await adminClient
    .from('projects')
    .update({ github_sync_error: null, github_exported_at: new Date().toISOString() })
    .eq('id', projectId)
}

export async function syncCharterToGitHub(projectId: string): Promise<GitHubSyncResult> {
  const ctx = await getOwnerToken(projectId)
  if (!ctx) return {} // silent skip

  const supabase = await createClient()
  try {
    const { data: charter } = await supabase
      .from('project_charter')
      .select('id, content, github_file_sha')
      .eq('project_id', projectId)
      .single()
    if (!charter?.content) return {}

    const { sha } = await pushFile(
      ctx.token,
      ctx.repoFullName,
      'docs/Charter.md',
      charter.content,
      charter.github_file_sha ?? undefined
    )
    await supabase.from('project_charter').update({ github_file_sha: sha }).eq('id', charter.id)
    await clearError(projectId)
    return { githubSyncError: null }
  } catch (err) {
    const message = err instanceof GitHubError ? err.message : 'GitHub sync failed'
    await saveError(projectId, message)
    return { githubSyncError: message }
  }
}

export async function syncPrdToGitHub(projectId: string): Promise<GitHubSyncResult> {
  const ctx = await getOwnerToken(projectId)
  if (!ctx) return {} // silent skip

  const supabase = await createClient()
  try {
    const { data: prd } = await supabase
      .from('prd')
      .select('id, content, github_file_sha')
      .eq('project_id', projectId)
      .single()
    if (!prd?.content) return {}

    const { sha } = await pushFile(
      ctx.token,
      ctx.repoFullName,
      'docs/PRD.md',
      prd.content,
      prd.github_file_sha ?? undefined
    )
    await supabase.from('prd').update({ github_file_sha: sha }).eq('id', prd.id)
    await clearError(projectId)
    return { githubSyncError: null }
  } catch (err) {
    const message = err instanceof GitHubError ? err.message : 'GitHub sync failed'
    await saveError(projectId, message)
    return { githubSyncError: message }
  }
}

export async function syncEpicToGitHub(epicId: string, projectId: string): Promise<GitHubSyncResult> {
  const ctx = await getOwnerToken(projectId)
  if (!ctx) return {}

  const supabase = await createClient()
  try {
    const { data: epic } = await supabase
      .from('epics')
      .select('id, code, title, description, github_milestone_number')
      .eq('id', epicId)
      .single()
    if (!epic) return {}

    const title = `${epic.code}: ${epic.title}`
    const description = epic.description ?? ''

    if (epic.github_milestone_number) {
      await updateMilestone(ctx.token, ctx.repoFullName, epic.github_milestone_number, title, description)
    } else {
      const milestone = await createMilestone(ctx.token, ctx.repoFullName, title, description)
      await supabase.from('epics').update({ github_milestone_number: milestone.number }).eq('id', epicId)
    }

    await clearError(projectId)
    return { githubSyncError: null }
  } catch (err) {
    const message = err instanceof GitHubError ? err.message : 'GitHub sync failed'
    await saveError(projectId, message)
    return { githubSyncError: message }
  }
}

export async function syncStoryToGitHub(storyId: string, projectId: string): Promise<GitHubSyncResult> {
  const ctx = await getOwnerToken(projectId)
  if (!ctx) return {}

  const supabase = await createClient()
  try {
    const { data: story } = await supabase
      .from('user_stories')
      .select('id, code, title, as_a, i_want, so_that, epic_id, github_issue_number')
      .eq('id', storyId)
      .single()
    if (!story) return {}

    const title = `${story.code}: ${story.title}`
    const body = formatStoryBody(story.as_a, story.i_want, story.so_that)

    // Look up epic's milestone number if story has an epic
    let milestone: number | undefined
    if (story.epic_id) {
      const { data: epic } = await supabase
        .from('epics')
        .select('github_milestone_number')
        .eq('id', story.epic_id)
        .single()
      milestone = epic?.github_milestone_number ?? undefined
    }

    if (story.github_issue_number) {
      await updateIssue(ctx.token, ctx.repoFullName, story.github_issue_number, title, body)
    } else {
      const issue = await createIssue(ctx.token, ctx.repoFullName, title, body, milestone)
      await supabase.from('user_stories').update({ github_issue_number: issue.number }).eq('id', storyId)
    }

    await clearError(projectId)
    return { githubSyncError: null }
  } catch (err) {
    const message = err instanceof GitHubError ? err.message : 'GitHub sync failed'
    await saveError(projectId, message)
    return { githubSyncError: message }
  }
}
