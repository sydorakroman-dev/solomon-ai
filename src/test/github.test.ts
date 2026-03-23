import { describe, it, expect } from 'vitest'
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
