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
