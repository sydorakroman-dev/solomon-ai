// src/app/api/projects/[id]/github/init/route.ts
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  GitHubError,
  slugifyRepoName,
  createRepo,
  copyRepoDir,
  pushFile,
} from '@/lib/github'
import { repoNameFromUrl } from '@/lib/github-sync'

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

  const token = process.env.GITHUB_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json(
      { error: 'GitHub integration not configured. Contact your administrator.' },
      { status: 503 }
    )
  }

  const org = process.env.GITHUB_ORG
  if (!org) {
    return NextResponse.json(
      { error: 'GitHub organization not configured. Contact your administrator.' },
      { status: 503 }
    )
  }

  const templateRepo = process.env.GITHUB_TEMPLATE_REPO
  if (!templateRepo) {
    return NextResponse.json(
      { error: 'GitHub template repository not configured. Contact your administrator.' },
      { status: 503 }
    )
  }

  const adminClient = await createAdminClient()

  const body = await request.json() as { repoName?: string; isPrivate?: boolean }
  const repoName = body.repoName?.trim() || slugifyRepoName(project.name)
  const isPrivate = body.isPrivate ?? false

  try {
    let repoFullName: string
    let repoUrl: string

    if (project.github_repo_url) {
      // Partial export — reuse existing repo
      repoUrl = project.github_repo_url
      repoFullName = repoNameFromUrl(repoUrl)
    } else {
      // Create new repo
      const repo = await createRepo(token, org, repoName, isPrivate)
      repoFullName = repo.full_name
      repoUrl = repo.html_url
      // Save immediately so partial retry works
      await supabase.from('projects').update({ github_repo_url: repoUrl }).eq('id', id)
    }

    // Sync template GitHub workflows/config
    await copyRepoDir(token, templateRepo, '.github', repoFullName, '.github')

    // Push Charter (if content exists)
    const { data: charter } = await supabase
      .from('project_charter')
      .select('id, content, github_file_sha')
      .eq('project_id', id)
      .single()
    if (charter?.content) {
      const { sha } = await pushFile(
        token,
        repoFullName,
        'docs/Charter.md',
        charter.content,
        charter.github_file_sha ?? undefined,
        'docs: add Project Charter'
      )
      await supabase.from('project_charter').update({ github_file_sha: sha }).eq('id', charter.id)
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

    // Mark export complete
    await supabase
      .from('projects')
      .update({ github_exported_at: new Date().toISOString(), github_sync_error: null })
      .eq('id', id)

    return NextResponse.json({ repoUrl })
  } catch (err) {
    let message: string
    let httpStatus: number

    if (err instanceof GitHubError) {
      if (err.status === 401) {
        message = 'GitHub token invalid or expired — update GITHUB_ACCESS_TOKEN'
        httpStatus = 401
      } else if (err.status === 404) {
        message = 'GitHub repo not found. Recreate from Project Settings.'
        httpStatus = 404
      } else if (err.status === 422) {
        message = 'A repository with this name already exists in your GitHub account'
        httpStatus = 422
      } else {
        message = err.message
        httpStatus = err.status
      }
    } else {
      message = 'Failed to export to GitHub'
      httpStatus = 500
    }

    await adminClient.from('projects').update({ github_sync_error: message }).eq('id', id)
    return NextResponse.json({ error: message }, { status: httpStatus })
  }
}
