# GitHub Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-way export from Solomon (PRD, Epics, User Stories) to a GitHub repository owned by the project owner, with auto-sync on every save.

**Architecture:** Each user connects their own GitHub account via OAuth (GitHub OAuth App). On first export, an API route creates a GitHub repo, pushes `docs/PRD.md`, creates milestones for Epics, and creates Issues for Stories. After export, the existing Epic/Story/PRD save routes call shared sync helper functions after the DB write succeeds; the response includes a `githubSyncError` field so the client can show a toast.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS), GitHub REST API v3, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-github-integration-design.md`

---

## Chunk 1: Foundation

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/007_github_integration.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/007_github_integration.sql
-- Add GitHub connection fields to profiles
alter table public.profiles
  add column if not exists github_access_token text,
  add column if not exists github_username      text,
  add column if not exists github_connected_at  timestamptz;

-- Add GitHub export tracking to projects
alter table public.projects
  add column if not exists github_repo_url    text,
  add column if not exists github_exported_at timestamptz,
  add column if not exists github_sync_error  text;

-- Add GitHub reference to epics
alter table public.epics
  add column if not exists github_milestone_number integer;

-- Add GitHub reference to user_stories
alter table public.user_stories
  add column if not exists github_issue_number integer;

-- Add GitHub file SHA to prd (needed by GitHub Contents API to update a file)
alter table public.prd
  add column if not exists github_file_sha text;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected: migration applied with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_github_integration.sql
git commit -m "feat: add github integration db columns"
```

---

### Task 2: Update TypeScript Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add GitHub fields to existing types**

In `src/types/index.ts`, update the `Profile`, `Project`, `Epic`, `UserStory` interfaces, and add GitHub fields to the `PRD` interface. Find each interface and add the fields shown:

Add to `Profile` interface (after `created_at`):
```typescript
  github_access_token: string | null
  github_username: string | null
  github_connected_at: string | null
```

Add to `Project` interface (after `updated_at`):
```typescript
  github_repo_url: string | null
  github_exported_at: string | null
  github_sync_error: string | null
```

Add to `Epic` interface (after `updated_at`):
```typescript
  github_milestone_number: number | null
```

Add to `UserStory` interface (after `updated_at`):
```typescript
  github_issue_number: number | null
```

Add to `PRD` interface (after `updated_at`):
```typescript
  github_file_sha: string | null
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add github fields to TypeScript types"
```

---

### Task 3: GitHub API Helper Library

**Files:**
- Create: `src/lib/github.ts`
- Create: `src/test/github.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/test/github.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitHubError, slugifyRepoName, formatStoryBody } from '@/lib/github'

describe('slugifyRepoName', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugifyRepoName('My Project Name')).toBe('my-project-name')
  })
  it('removes special characters', () => {
    expect(slugifyRepoName('Project: v2.0!')).toBe('project-v2-0')
  })
  it('trims leading and trailing hyphens', () => {
    expect(slugifyRepoName('  !project!  ')).toBe('project')
  })
})

describe('formatStoryBody', () => {
  it('formats BDD fields into markdown', () => {
    const body = formatStoryBody('a PM', 'generate a PRD', 'save time')
    expect(body).toBe('**As a** a PM\n**I want** generate a PRD\n**So that** save time')
  })
})

describe('GitHubError', () => {
  it('has status and message', () => {
    const err = new GitHubError(422, 'name already exists')
    expect(err.status).toBe(422)
    expect(err.message).toBe('name already exists')
    expect(err instanceof Error).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/test/github.test.ts
```

Expected: FAIL — `GitHubError`, `slugifyRepoName`, `formatStoryBody` not found.

- [ ] **Step 3: Create the GitHub helper library**

```typescript
// src/lib/github.ts
const BASE = 'https://api.github.com'

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'GitHubError'
  }
}

export function slugifyRepoName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function formatStoryBody(asA: string, iWant: string, soThat: string): string {
  return `**As a** ${asA}\n**I want** ${iWant}\n**So that** ${soThat}`
}

async function ghFetch(token: string, path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new GitHubError(res.status, (body as { message?: string }).message ?? `GitHub API error ${res.status}`)
  }
  return res
}

export async function getGitHubUser(token: string): Promise<{ login: string }> {
  const res = await ghFetch(token, '/user')
  return res.json()
}

export async function createRepo(
  token: string,
  name: string,
  isPrivate: boolean
): Promise<{ full_name: string; html_url: string }> {
  const res = await ghFetch(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
  })
  return res.json()
}

// NOTE: pushFile uses Buffer.from() which requires the Node.js runtime.
// All routes that call this function must NOT use `export const runtime = 'edge'`.
export async function pushFile(
  token: string,
  repo: string,
  path: string,
  content: string,
  sha?: string,
  message = 'chore: update requirements'
): Promise<{ sha: string }> {
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content).toString('base64'),
  }
  if (sha) body.sha = sha
  const res = await ghFetch(token, `/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  const data = await res.json() as { content: { sha: string } }
  return { sha: data.content.sha }
}

export async function createMilestone(
  token: string,
  repo: string,
  title: string,
  description = ''
): Promise<{ number: number }> {
  const res = await ghFetch(token, `/repos/${repo}/milestones`, {
    method: 'POST',
    body: JSON.stringify({ title, description }),
  })
  return res.json()
}

export async function updateMilestone(
  token: string,
  repo: string,
  number: number,
  title: string,
  description = ''
): Promise<void> {
  await ghFetch(token, `/repos/${repo}/milestones/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, description }),
  })
}

export async function createIssue(
  token: string,
  repo: string,
  title: string,
  body: string,
  milestone?: number
): Promise<{ number: number }> {
  const res = await ghFetch(token, `/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title, body, ...(milestone ? { milestone } : {}) }),
  })
  return res.json()
}

export async function updateIssue(
  token: string,
  repo: string,
  number: number,
  title: string,
  body: string
): Promise<void> {
  await ghFetch(token, `/repos/${repo}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, body }),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/github.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/github.ts src/test/github.test.ts
git commit -m "feat: add github API helper library"
```

---

### Task 4: GitHub Sync Helper

**Files:**
- Create: `src/lib/github-sync.ts`
- Create: `src/test/github-sync.test.ts`

Context: This module is called from save API routes (PRD, Epic, Story PATCH handlers) after the DB write succeeds. It returns `{ githubSyncError?: string | null }` — the field is **omitted** on silent skip (no repo url / no token), `null` on success, or an error string on failure. The client reads this field from the save response to decide whether to show a toast.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/test/github-sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock supabase clients ──────────────────────────────────────────────────────
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) })
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ from: mockFrom }),
  createAdminClient: vi.fn().mockResolvedValue({ from: mockFrom }),
}))

// ── Mock github API calls ──────────────────────────────────────────────────────
vi.mock('@/lib/github', () => ({
  GitHubError: class GitHubError extends Error {
    constructor(public status: number, message: string) { super(message) }
  },
  pushFile: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  formatStoryBody: vi.fn((a: string, b: string, c: string) => `${a} ${b} ${c}`),
}))

import { repoNameFromUrl, syncPrdToGitHub } from '@/lib/github-sync'
import { pushFile, GitHubError } from '@/lib/github'

// ── Pure function tests ────────────────────────────────────────────────────────
describe('repoNameFromUrl', () => {
  it('extracts full_name from github URL', () => {
    expect(repoNameFromUrl('https://github.com/octocat/my-repo')).toBe('octocat/my-repo')
  })
  it('handles trailing slash', () => {
    expect(repoNameFromUrl('https://github.com/octocat/my-repo/')).toBe('octocat/my-repo')
  })
})

// ── syncPrdToGitHub ────────────────────────────────────────────────────────────
describe('syncPrdToGitHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty object (silent skip) when project has no github_repo_url', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { user_id: 'u1', github_repo_url: null } }) }),
      }),
    })
    const result = await syncPrdToGitHub('proj-1')
    expect(result).toEqual({})
    expect(pushFile).not.toHaveBeenCalled()
  })

  it('returns { githubSyncError: null } on successful sync', async () => {
    // getOwnerToken: project has repo_url, profile has token
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // projects query (user-scoped)
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { user_id: 'u1', github_repo_url: 'https://github.com/user/repo' } }) }) }) }
      }
      if (callCount === 2) {
        // profiles query (admin-scoped)
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { github_access_token: 'tok' } }) }) }) }
      }
      if (callCount === 3) {
        // prd query
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'prd-1', content: '# PRD', github_file_sha: null } }) }) }) }
      }
      // prd update + projects update
      return { update: mockUpdate }
    })
    vi.mocked(pushFile).mockResolvedValue({ sha: 'abc123' })

    const result = await syncPrdToGitHub('proj-1')
    expect(result).toEqual({ githubSyncError: null })
  })

  it('returns { githubSyncError: "..." } and saves error on GitHub failure', async () => {
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { user_id: 'u1', github_repo_url: 'https://github.com/user/repo' } }) }) }) }
      }
      if (callCount === 2) {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { github_access_token: 'tok' } }) }) }) }
      }
      if (callCount === 3) {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'prd-1', content: '# PRD', github_file_sha: null } }) }) }) }
      }
      return { update: mockUpdate }
    })
    vi.mocked(pushFile).mockRejectedValue(new (GitHubError as unknown as new (s: number, m: string) => Error)(500, 'server error'))

    const result = await syncPrdToGitHub('proj-1')
    expect(typeof result.githubSyncError).toBe('string')
    expect(result.githubSyncError).toBe('server error')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/test/github-sync.test.ts
```

Expected output:
```
FAIL src/test/github-sync.test.ts
Error: Failed to resolve import "@/lib/github-sync" from "src/test/github-sync.test.ts"
```

- [ ] **Step 3: Create the sync helper**

```typescript
// src/lib/github-sync.ts
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
): Promise<{ token: string; repoFullName: string; ownerId: string } | null> {
  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('user_id, github_repo_url')
    .eq('id', projectId)
    .single()
  if (!project?.github_repo_url) return null

  const adminClient = await createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('github_access_token')
    .eq('user_id', project.user_id)
    .single()
  if (!profile?.github_access_token) return null

  return {
    token: profile.github_access_token,
    repoFullName: repoNameFromUrl(project.github_repo_url),
    ownerId: project.user_id,
  }
}

async function handleTokenRevoked(ownerId: string): Promise<void> {
  const adminClient = await createAdminClient()
  await adminClient
    .from('profiles')
    .update({ github_access_token: null, github_username: null, github_connected_at: null })
    .eq('user_id', ownerId)
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
    if (err instanceof GitHubError && err.status === 401) await handleTokenRevoked(ctx.ownerId)
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
    if (err instanceof GitHubError && err.status === 401) await handleTokenRevoked(ctx.ownerId)
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
    if (err instanceof GitHubError && err.status === 401) await handleTokenRevoked(ctx.ownerId)
    await saveError(projectId, message)
    return { githubSyncError: message }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/github-sync.test.ts
```

Expected: 5 tests PASS (2 `repoNameFromUrl` + 3 `syncPrdToGitHub`).

- [ ] **Step 5: Run full test suite to verify nothing is broken**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/github-sync.ts src/test/github-sync.test.ts
git commit -m "feat: add github sync helper functions"
```

---

## Chunk 2: API Routes

### Task 5: GitHub OAuth Routes

**Files:**
- Create: `src/app/api/auth/github/route.ts`
- Create: `src/app/api/auth/github/callback/route.ts`

- [ ] **Step 1: Create the OAuth initiate + disconnect route**

```typescript
// src/app/api/auth/github/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'GitHub OAuth not configured' }, { status: 500 })

  const appUrl = process.env.APP_URL ?? 'https://solomon.quitcode.com'
  const redirectUri = encodeURIComponent(`${appUrl}/api/auth/github/callback`)
  const scope = encodeURIComponent('repo')
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`
  return NextResponse.redirect(url)
}

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await supabase
    .from('profiles')
    .update({ github_access_token: null, github_username: null, github_connected_at: null })
    .eq('user_id', user.id)

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Create the OAuth callback route**

```typescript
// src/app/api/auth/github/callback/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGitHubUser } from '@/lib/github'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) return NextResponse.redirect(`${origin}/profile?error=github_auth_failed`)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const tokenData = await tokenRes.json() as { access_token?: string }
  const accessToken = tokenData.access_token
  if (!accessToken) return NextResponse.redirect(`${origin}/profile?error=github_auth_failed`)

  // Get GitHub username
  let githubUsername: string
  try {
    const githubUser = await getGitHubUser(accessToken)
    githubUsername = githubUser.login
  } catch {
    return NextResponse.redirect(`${origin}/profile?error=github_auth_failed`)
  }

  // Save to profiles
  await supabase
    .from('profiles')
    .update({
      github_access_token: accessToken,
      github_username: githubUsername,
      github_connected_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  return NextResponse.redirect(`${origin}/profile?github=connected`)
}
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/auth/github/route.ts" "src/app/api/auth/github/callback/route.ts"
git commit -m "feat: add github OAuth routes (connect/disconnect/callback)"
```

---

### Task 6: Profile API — Add GitHub Fields to GET Response

**Files:**
- Modify: `src/app/api/profile/route.ts`

The profile page needs to show GitHub connection status. Add `github_username` and `github_connected_at` to the GET response.

- [ ] **Step 1: Update the GET handler in `src/app/api/profile/route.ts`**

Find this block (lines 9–18):
```typescript
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({
    email: user.email,
    full_name: profile?.full_name ?? null,
  })
```

Replace with:
```typescript
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, github_username, github_connected_at')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({
    email: user.email,
    full_name: profile?.full_name ?? null,
    github_username: profile?.github_username ?? null,
    github_connected_at: profile?.github_connected_at ?? null,
  })
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/profile/route.ts
git commit -m "feat: expose github connection status in profile API"
```

---

### Task 7: GitHub Init Route

**Files:**
- Create: `src/app/api/projects/[id]/github/init/route.ts`

- [ ] **Step 1: Create the init route**

```typescript
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
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/projects/[id]/github/init/route.ts"
git commit -m "feat: add github project init (export) route"
```

---

### Task 8: GitHub Full Sync Route

**Files:**
- Create: `src/app/api/projects/[id]/github/sync/route.ts`

This route powers the "Sync now" button and the "Retry" button on the failure toast. It re-syncs everything.

- [ ] **Step 1: Create the full sync route**

```typescript
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
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/projects/[id]/github/sync/route.ts"
git commit -m "feat: add github full sync route"
```

---

### Task 9: Modify Save Routes to Trigger Auto-Sync

**Files:**
- Modify: `src/app/api/prd/[id]/route.ts`
- Modify: `src/app/api/epics/[id]/route.ts`
- Modify: `src/app/api/stories/[id]/route.ts`

After each DB save, call the corresponding sync helper. The response includes `githubSyncError` when a sync was attempted (null = success, string = error). The field is omitted when sync was not applicable.

- [ ] **Step 1: Modify the PRD PATCH route**

In `src/app/api/prd/[id]/route.ts`, add the import at the top (after existing imports):
```typescript
import { syncPrdToGitHub } from '@/lib/github-sync'
```

Find the **final** `return NextResponse.json(data)` — it is on the last line of the PATCH handler, after the `if (body.status === 'approved')` block (approximately line 37). Do NOT replace the earlier error returns. Replace only this final return:
```typescript
  const syncResult = await syncPrdToGitHub(prd.project_id)
  return NextResponse.json({ ...data, ...syncResult })
```

Note: this means approving a PRD (a `status`-only PATCH) will also trigger a sync. This is intentional — the approved PRD content is pushed to GitHub. The client `handleApprove` handler will receive `githubSyncError` in the response; handle it in Step 6 below the same way as `handleSave`.

- [ ] **Step 2: Modify the Epic PATCH route**

In `src/app/api/epics/[id]/route.ts`, add the import:
```typescript
import { syncEpicToGitHub } from '@/lib/github-sync'
```

Find this block in the PATCH handler:
```typescript
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
```

Replace with:
```typescript
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const syncResult = await syncEpicToGitHub(id, data.project_id as string)
  return NextResponse.json({ ...data, ...syncResult })
```

- [ ] **Step 3: Modify the Story PATCH route**

In `src/app/api/stories/[id]/route.ts`, add the import:
```typescript
import { syncStoryToGitHub } from '@/lib/github-sync'
```

Find this block in the PATCH handler:
```typescript
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
```

Replace with:
```typescript
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const syncResult = await syncStoryToGitHub(id, data.project_id as string)
  return NextResponse.json({ ...data, ...syncResult })
```

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/prd/[id]/route.ts src/app/api/epics/[id]/route.ts src/app/api/stories/[id]/route.ts
git commit -m "feat: trigger github auto-sync in save routes"
```

---

## Chunk 3: UI

### Task 10: Profile Page — GitHub Section

**Files:**
- Modify: `src/app/(dashboard)/profile/page.tsx`

Add a "GitHub" section below the existing profile cards. Shows connect/disconnect state.

- [ ] **Step 1: Add state and load github data**

In `src/app/(dashboard)/profile/page.tsx`, find the existing state declarations at the top of `ProfilePage` and add:
```typescript
  const [githubUsername, setGithubUsername] = useState<string | null>(null)
  const [githubConnectedAt, setGithubConnectedAt] = useState<string | null>(null)
  const [disconnectingGitHub, setDisconnectingGitHub] = useState(false)
```

Find the `useEffect` that fetches `/api/profile` and update the `.then()` handler to also set GitHub state. Find:
```typescript
      if (data?.email) setCurrentEmail(data.email)
      if (data?.full_name) setProfileName(data.full_name)
```

Replace with:
```typescript
      if (data?.email) setCurrentEmail(data.email)
      if (data?.full_name) setProfileName(data.full_name)
      setGithubUsername(data?.github_username ?? null)
      setGithubConnectedAt(data?.github_connected_at ?? null)
```

- [ ] **Step 2: Add disconnect handler**

Add this function inside `ProfilePage`, before the `return`:
```typescript
  async function handleDisconnectGitHub() {
    setDisconnectingGitHub(true)
    try {
      const res = await fetch('/api/auth/github', { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      setGithubUsername(null)
      setGithubConnectedAt(null)
      toast.success('GitHub disconnected')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect GitHub')
    } finally {
      setDisconnectingGitHub(false)
    }
  }
```

Also add a `useEffect` to handle the `?github=connected` and `?error=github_auth_failed` URL params. Add this after the existing `useEffect`:
```typescript
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('github') === 'connected') {
      toast.success('GitHub connected successfully')
      window.history.replaceState({}, '', '/profile')
      // Reload profile to get updated github_username
      fetch('/api/profile').then(r => r.ok ? r.json() : null).then(data => {
        if (data?.github_username) setGithubUsername(data.github_username)
        if (data?.github_connected_at) setGithubConnectedAt(data.github_connected_at)
      })
    }
    if (params.get('error') === 'github_auth_failed') {
      toast.error('GitHub authorization failed. Please try again.')
      window.history.replaceState({}, '', '/profile')
    }
  }, [])
```

- [ ] **Step 3: Add the GitHub Card to the JSX**

In `src/app/(dashboard)/profile/page.tsx`, find the import for `Github` icon — add it to the lucide-react import:
```typescript
import { Eye, EyeOff, Github } from 'lucide-react'
```

Inside the `return`, after the last existing `</Card>` closing tag (before the outer `</div>`), add:
```tsx
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Github className="h-4 w-4" />
              GitHub
            </CardTitle>
            <CardDescription>
              Connect your GitHub account to export requirements to GitHub repositories.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {githubUsername ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Connected as @{githubUsername}</p>
                  {githubConnectedAt && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Since {new Date(githubConnectedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnectGitHub}
                  disabled={disconnectingGitHub}
                >
                  {disconnectingGitHub ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Not connected. Solomon will create and update repositories on your behalf.
                </p>
                <Button asChild size="sm">
                  <a href="/api/auth/github">
                    <Github className="h-4 w-4 mr-2" />
                    Connect GitHub
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
```

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/profile/page.tsx"
git commit -m "feat: add github connect/disconnect to profile page"
```

---

### Task 11: Project Settings — GitHub Tab

**Files:**
- Modify: `src/app/(dashboard)/project/[id]/settings/page.tsx`

Add a "GitHub" tab alongside Members and Prompts. Shows export status, init button, sync button, error banner.

- [ ] **Step 1: Add GitHub icon to imports**

Find the existing lucide-react import in `src/app/(dashboard)/project/[id]/settings/page.tsx`:
```typescript
import { Users, Sliders } from 'lucide-react'
```

Replace with:
```typescript
import { Users, Sliders, Github, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react'
```

- [ ] **Step 2: Add GitHub state and fetch logic**

After the existing state declarations (after `const [saving, setSaving] = useState<PromptStage | null>(null)`), add:
```typescript
  const [isOwner, setIsOwner] = useState(false)
  const [githubRepoUrl, setGithubRepoUrl] = useState<string | null>(null)
  const [githubExportedAt, setGithubExportedAt] = useState<string | null>(null)
  const [githubSyncError, setGithubSyncError] = useState<string | null>(null)
  const [currentUserGithubUsername, setCurrentUserGithubUsername] = useState<string | null>(null)
  const [showInitModal, setShowInitModal] = useState(false)
  const [initRepoName, setInitRepoName] = useState('')
  const [initIsPrivate, setInitIsPrivate] = useState(false)
  const [initLoading, setInitLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
```

Find the existing `Promise.all([...])` in the `useEffect` and extend it to also fetch project GitHub status and current user profile. Replace the current `Promise.all` entirely:

```typescript
    Promise.all([
      fetch(`/api/project-prompts?project_id=${id}`).then(r => r.json()),
      fetch('/api/system-prompts').then(r => r.json()),
      fetch(`/api/projects/${id}`).then(r => r.ok ? r.json() : null),
      fetch('/api/profile').then(r => r.ok ? r.json() : null),
    ]).then(([projectPrompts, sysPrompts, project, profile]) => {
      if (Array.isArray(projectPrompts)) {
        const map: Record<string, string> = {}
        projectPrompts.forEach((p: { stage: string; content: string }) => { map[p.stage] = p.content })
        setPrompts(prev => ({ ...prev, ...map }))
      }
      if (Array.isArray(sysPrompts)) {
        const map: Record<string, string> = {}
        sysPrompts.forEach((p: { stage: string; content: string }) => { map[p.stage] = p.content })
        setSystemDefaults(prev => ({ ...prev, ...map }))
      }
      if (project) {
        // project is returned only for the owner (GET route requires user_id match)
        setIsOwner(true)
        setGithubRepoUrl(project.github_repo_url ?? null)
        setGithubExportedAt(project.github_exported_at ?? null)
        setGithubSyncError(project.github_sync_error ?? null)
        setInitRepoName(project.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ?? '')
      }
      if (profile) {
        setCurrentUserGithubUsername(profile.github_username ?? null)
      }
    }).finally(() => setLoading(false))
```

- [ ] **Step 3: Ensure GET /api/projects/[id] exists and is owner-scoped**

Run:
```bash
ls src/app/api/projects/[id]/route.ts
```

Open `src/app/api/projects/[id]/route.ts` and verify it has a GET handler that uses `.eq('user_id', user.id)`. This owner-only scope is intentional — it acts as the ownership check for the GitHub tab. If GET returns null (collaborator), `isOwner` stays `false` and the GitHub tab shows a "contact project owner" message.

If the GET handler does not exist, add it:
```typescript
// In src/app/api/projects/[id]/route.ts — ensure these imports are present at top:
// import { NextResponse } from 'next/server'
// import { createClient } from '@/lib/supabase/server'
// type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: project, error } = await supabase
    .from('projects')
    .select('id, name, github_repo_url, github_exported_at, github_sync_error, user_id')
    .eq('id', id)
    .eq('user_id', user.id)   // owner-only — intentional
    .single()
  if (error || !project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(project)
}
```

- [ ] **Step 4: Add handler functions for init and sync**

Add these functions to the `ProjectSettingsPage` component:

```typescript
  async function handleInitGitHub() {
    setInitLoading(true)
    try {
      const res = await fetch(`/api/projects/${id}/github/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoName: initRepoName, isPrivate: initIsPrivate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setGithubRepoUrl(data.repoUrl)
      setGithubExportedAt(new Date().toISOString())
      setGithubSyncError(null)
      setShowInitModal(false)
      toast.success('Exported to GitHub')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setInitLoading(false)
    }
  }

  async function handleSyncGitHub() {
    setSyncing(true)
    try {
      const res = await fetch(`/api/projects/${id}/github/sync`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setGithubExportedAt(new Date().toISOString())
      setGithubSyncError(null)
      toast.success('Synced to GitHub')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      setGithubSyncError(message)
      toast.error(`GitHub sync failed: ${message}`)
    } finally {
      setSyncing(false)
    }
  }
```

- [ ] **Step 5: Add the GitHub tab to the JSX**

Find the existing `<TabsList className="mb-6">` and add a GitHub trigger:
```tsx
          <TabsTrigger value="github" className="gap-1.5">
            <Github className="h-3.5 w-3.5" />GitHub
          </TabsTrigger>
```

After the closing `</TabsContent>` of the `prompts` tab, add:

```tsx
        <TabsContent value="github">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">GitHub Repository</CardTitle>
              <CardDescription>
                Export this project's requirements to a GitHub repository. Syncs automatically on every save.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {githubSyncError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">GitHub sync failed</p>
                    <p className="mt-0.5 text-xs">{githubSyncError}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleSyncGitHub} disabled={syncing}>
                    {syncing ? 'Retrying...' : 'Retry'}
                  </Button>
                </div>
              )}

              {!isOwner ? (
                <p className="text-sm text-muted-foreground">
                  GitHub settings are only visible to the project owner.
                </p>
              ) : githubRepoUrl ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <a
                        href={githubRepoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-sm font-medium hover:underline"
                      >
                        <Github className="h-4 w-4" />
                        {githubRepoUrl.replace('https://github.com/', '')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {githubExportedAt && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Last synced: {new Date(githubExportedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSyncGitHub}
                      disabled={syncing}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
                      {syncing ? 'Syncing...' : 'Sync now'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {!currentUserGithubUsername ? (
                    <p className="text-sm text-muted-foreground">
                      Connect your GitHub account in{' '}
                      <a href="/profile" className="underline underline-offset-2">Profile</a>{' '}
                      to export this project to GitHub.
                    </p>
                  ) : (
                    <>
                      {showInitModal ? (
                        <div className="space-y-3 rounded-lg border p-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="repo-name">Repository name</Label>
                            <Input
                              id="repo-name"
                              value={initRepoName}
                              onChange={e => setInitRepoName(e.target.value)}
                              placeholder="my-project"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="repo-private"
                              checked={initIsPrivate}
                              onChange={e => setInitIsPrivate(e.target.checked)}
                              className="h-4 w-4"
                            />
                            <Label htmlFor="repo-private" className="font-normal">Private repository</Label>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={handleInitGitHub}
                              disabled={initLoading || !initRepoName.trim()}
                            >
                              {initLoading ? 'Creating...' : 'Create repository'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setShowInitModal(false)}
                              disabled={initLoading}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" onClick={() => setShowInitModal(true)}>
                          <Github className="h-4 w-4 mr-2" />
                          Create GitHub Repository
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
```

Also add `Input` to the imports at the top of the file:
```typescript
import { Input } from '@/components/ui/input'
```

- [ ] **Step 6: Handle githubSyncError toasts in save pages**

**PRD page** (`src/app/(dashboard)/project/[id]/prd/page.tsx`) — `handleSave` currently does `setPrd(await res.json())` inline. Split it into two lines and add the toast check:

Find:
```typescript
    if (!res.ok) throw new Error((await res.json()).error)
    setPrd(await res.json())
    setEditing(false)
    toast.success('PRD saved')
```

Replace with:
```typescript
    if (!res.ok) throw new Error((await res.json()).error)
    const saved = await res.json()
    setPrd(saved)
    setEditing(false)
    toast.success('PRD saved')
    if ('githubSyncError' in saved) {
      if (saved.githubSyncError === null) {
        toast.success('Synced to GitHub')
      } else {
        toast.error(`GitHub sync failed: ${saved.githubSyncError}`)
      }
    }
```

Also find the `handleApprove` handler (which also calls `fetch('/api/prd/...')` PATCH) and apply the same pattern to its response handling.

**Epics page** (`src/app/(dashboard)/project/[id]/epics/page.tsx`) — `updateEpic` uses variable name `updated`:

Find:
```typescript
    const updated = await res.json()
    setEpics(prev => prev.map(e => e.id === epicId ? updated : e))
```

Replace with:
```typescript
    const updated = await res.json()
    setEpics(prev => prev.map(e => e.id === epicId ? updated : e))
    if ('githubSyncError' in updated) {
      if (updated.githubSyncError === null) {
        toast.success('Synced to GitHub')
      } else {
        toast.error(`GitHub sync failed: ${updated.githubSyncError}`)
      }
    }
```

Ensure `toast` from `sonner` is imported in the epics page — add `import { toast } from 'sonner'` if missing.

**Stories page** (`src/app/(dashboard)/project/[id]/stories/page.tsx`) — `updateStory` uses variable name `updated`:

Find:
```typescript
    const updated = await res.json()
    setStories(prev => prev.map(s => s.id === storyId ? updated : s))
```

Replace with:
```typescript
    const updated = await res.json()
    setStories(prev => prev.map(s => s.id === storyId ? updated : s))
    if ('githubSyncError' in updated) {
      if (updated.githubSyncError === null) {
        toast.success('Synced to GitHub')
      } else {
        toast.error(`GitHub sync failed: ${updated.githubSyncError}`)
      }
    }
```

Ensure `toast` from `sonner` is imported in the stories page — add `import { toast } from 'sonner'` if missing.

- [ ] **Step 7: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Run tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(dashboard)/project/[id]/settings/page.tsx" "src/app/(dashboard)/project/[id]/prd/page.tsx" "src/app/(dashboard)/project/[id]/epics/page.tsx" "src/app/(dashboard)/project/[id]/stories/page.tsx"
git commit -m "feat: add github tab to project settings and sync toasts"
```

---

## Environment Variables

After implementation, add to `.env.local` (dev) and production environment:

```
GITHUB_CLIENT_ID=your_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_oauth_app_client_secret
```

Register the GitHub OAuth App at `https://github.com/settings/developers`:
- **Application name:** Solomon
- **Homepage URL:** `https://solomon.quitcode.com`
- **Authorization callback URL:** `https://solomon.quitcode.com/api/auth/github/callback`
- **Requested scopes:** `repo`

For local dev, create a second OAuth App with callback `http://localhost:3000/api/auth/github/callback`.

---

## Testing Checklist

Manual verification steps after implementation:

- [ ] Connect GitHub in Profile → redirected back to `/profile`, username shown
- [ ] Disconnect GitHub → username cleared
- [ ] Project Settings → GitHub tab visible
- [ ] "Create GitHub Repository" button disabled when GitHub not connected
- [ ] Init creates repo with milestones (Epics) and issues (Stories)
- [ ] Edit an Epic title → GitHub milestone title updates, "Synced to GitHub" toast shown
- [ ] Edit a Story → GitHub issue updates
- [ ] Edit PRD → `docs/PRD.md` updates in GitHub
- [ ] Disconnect GitHub → next save shows no toast (silent skip)
- [ ] "Sync now" button re-syncs everything
- [ ] Error banner shown when `github_sync_error` is set
