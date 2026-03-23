# GitHub Integration Design

## Overview

One-way export from Solomon to GitHub. Solomon is the source of truth. Each user connects their own GitHub account via OAuth. On first export, a GitHub repository is created for the project. Subsequently, any save to a PRD, Epic, or User Story automatically syncs the change to GitHub.

**Mapping:**
- Solomon Project → GitHub Repository
- PRD → `docs/PRD.md` (file committed to repo)
- Epic → GitHub Milestone
- User Story → GitHub Issue assigned to its Epic's Milestone

---

## Data Model

### `profiles` — add three columns

| Column | Type | Notes |
|---|---|---|
| `github_access_token` | text | Stored in plaintext with RLS (same approach as other sensitive settings in the app); null when disconnected |
| `github_username` | text | Display name, e.g. `octocat` |
| `github_connected_at` | timestamptz | When OAuth was completed |

RLS ensures only the owning user can read/write their own row, consistent with existing `profiles` RLS policy.

### `projects` — add three columns

| Column | Type | Notes |
|---|---|---|
| `github_repo_url` | text | e.g. `https://github.com/user/my-project`; `NULL` = not exported; this is the canonical export guard |
| `github_exported_at` | timestamptz | Display-only timestamp of last successful sync; not used as a guard |
| `github_sync_error` | text | Last sync error message; null on success |

`github_repo_url IS NOT NULL` is the single authoritative check for "has this project been exported."

### `epics` — add one column

| Column | Type | Notes |
|---|---|---|
| `github_milestone_number` | integer | GitHub milestone number; null until exported |

### `user_stories` — add one column

| Column | Type | Notes |
|---|---|---|
| `github_issue_number` | integer | GitHub issue number; null until exported |

### `prd` — add one column

| Column | Type | Notes |
|---|---|---|
| `github_file_sha` | text | SHA of the current `docs/PRD.md` blob in GitHub; required by the Contents API to update the file; null until exported |

---

## GitHub OAuth

- Register a **GitHub OAuth App** with callback URL `/api/auth/github/callback`
- Scope: `repo` — required to create private repositories and push files. This grants broad read/write access to all user repos; this tradeoff is acknowledged and should be disclosed in the OAuth consent UI copy ("Solomon will be able to create and update repositories on your behalf").
- Env vars: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (server-only)

### Flow
1. User clicks "Connect GitHub" in Profile → `GET /api/auth/github` → redirect to GitHub authorization page
2. GitHub redirects back to `/api/auth/github/callback?code=...`
3. Server exchanges code for access token, saves `github_access_token` + `github_username` + `github_connected_at` to `profiles`
4. Redirect to `/profile`

---

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/github` | GET | Initiate OAuth — redirect to GitHub |
| `/api/auth/github/callback` | GET | Exchange code for token, save to profile |
| `/api/auth/github` | DELETE | Disconnect — clear token + username from profiles |
| `/api/projects/[id]/github/init` | POST | Create repo, push PRD, create all milestones + issues |
| `/api/projects/[id]/github/sync` | POST | Full re-sync — update PRD, all milestones, all issues |
| `/api/projects/[id]/github/prd` | PATCH | Push updated PRD file (called server-side after PRD DB save) |
| `/api/projects/[id]/github/epics/[epicId]` | PATCH | Update/create milestone (called server-side after Epic DB save) |
| `/api/projects/[id]/github/stories/[storyId]` | PATCH | Update/create issue (called server-side after Story DB save) |

### Token ownership
All sync routes use the **project owner's** GitHub token, not the token of whoever triggered the save. Each route fetches `projects.user_id`, then looks up `profiles.github_access_token` for that user_id using the admin client. This ensures the GitHub repo always lives under the project owner's account regardless of which collaborator saved the item.

### Init route behavior
1. Fetch project owner's `github_access_token` (403 if missing)
2. Create GitHub repo (name + visibility from request body; slugified project name as default; 422 if name already exists — surface error to user: "A repository with this name already exists in your GitHub account")
3. Save `github_repo_url` to project immediately (so partial retry works)
4. Fetch PRD content; push `docs/PRD.md`; save returned `sha` to `prd.github_file_sha`
5. For each Epic without `github_milestone_number`: create milestone, save number to DB
6. For each User Story without `github_issue_number`: create issue assigned to Epic's milestone, save number to DB
7. Save `github_exported_at` to project; clear `github_sync_error`

**Partial failure and retry:** `github_repo_url` is saved as soon as the repo is created (step 3). If steps 4–6 fail, the project has `github_repo_url` set but some items lack their numbers. On retry, the init route detects `github_repo_url` is already set, skips repo creation, and resumes from the failed step. Steps 5 and 6 are idempotent: skip items that already have numbers, create those that don't.

### Sync route behavior (idempotent — full re-sync)
- Fetch project owner's `github_access_token` (403 if missing)
- Fetch current `prd.github_file_sha`; if null, push file as new (first-time); otherwise update using SHA
- After successful PRD push, save new SHA to `prd.github_file_sha`
- For each Epic: update milestone if `github_milestone_number` set, create if not; save number if newly created
- For each Story: update issue if `github_issue_number` set, create if not; save number if newly created
- On success: clear `github_sync_error`, update `github_exported_at`
- On failure: save error message to `github_sync_error`

### Granular sync routes (PRD / Epic / Story)
Each is called **server-side** by the corresponding save API route after the DB write succeeds:
- `/api/prd/[id]` PATCH → after DB save, if project has `github_repo_url`, calls `PATCH /api/projects/[projectId]/github/prd`
- `/api/epics/[id]` PATCH → after DB save, calls `PATCH /api/projects/[projectId]/github/epics/[epicId]`
- `/api/stories/[id]` PATCH → after DB save, calls `PATCH /api/projects/[projectId]/github/stories/[storyId]`

**Authorization on granular routes:** These routes require owner-only access — the authenticated user must be the project owner (`projects.user_id = user.id`). Any collaborator calling these routes directly should receive a 403.

**`project_id` availability in Epic and Story PATCH handlers:** The Epic and Story PATCH routes update the DB row and receive the updated row back via `.select().single()`. The row includes `project_id`, which is used to construct the GitHub sub-route path. No additional query needed.

The save API route returns `{ ..., githubSyncError: string | null }` to the client **only when a sync was attempted**. The field is **omitted entirely** when sync is skipped (no `github_repo_url` or no owner token). This lets the client distinguish three states:
- Field present and `null` → sync succeeded → show "Synced to GitHub" toast
- Field present and `"..."` → sync failed → show failure toast with Retry
- Field absent → sync not applicable → no toast

Guard conditions checked server-side before calling any GitHub API:
1. `project.github_repo_url IS NOT NULL`
2. `owner_profile.github_access_token IS NOT NULL`

If either is missing, sync is skipped and `githubSyncError` is omitted from the response.

---

## Auto-Sync

Auto-sync is triggered **server-side** inside the existing save API routes after the DB write succeeds. No additional client-side logic is needed beyond reading the `githubSyncError` field in the save response and showing a toast.

**Toast behavior:**
- ✅ `githubSyncError: null` after a sync → toast "Synced to GitHub"
- ❌ `githubSyncError: "..."` after a sync → toast "GitHub sync failed: [error]" with a Retry button
- No `github_repo_url` on project (sync skipped) → no toast

**Retry button** on the failure toast calls `POST /api/projects/[id]/github/sync` (full re-sync), not the granular route. This is safe because the sync route is idempotent.

---

## Deleted Resources

Deleting an Epic or User Story in Solomon **does not** close or delete the corresponding GitHub milestone or issue. GitHub retains the full history. This is intentional — requirements history in GitHub should be preserved even if Solomon removes the item.

---

## UI

### Profile page — GitHub section
- **Disconnected:** "Connect GitHub" button; consent note: "Solomon will create and update repositories on your behalf"
- **Connected:** "Connected as @username" + "Disconnect" button

### Project Settings — GitHub tab (new, alongside Members / Prompts)
- **Not exported:** "Create GitHub Repository" button (disabled + tooltip "Connect GitHub in your profile first" if owner has no token; non-owners do not see this button)
- **Exported:** Repo URL as link, "Sync now" button, "Last synced: [timestamp]", error banner if `github_sync_error` is set

### Create GitHub Repository modal
- Repo name input (pre-filled: project name slugified)
- Visibility selector: Public / Private
- Confirm button with spinner during creation
- Inline error if repo name already exists

### Error banner (project page + settings)
Shown when `github_sync_error` is set:
> ⚠️ GitHub sync failed: [error]. [Retry]

Cleared on next successful sync.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| GitHub returns 401 (token revoked) | Clear token in profiles, return error to client: "GitHub connection lost — reconnect in Profile" |
| GitHub returns 404 (repo deleted) | Return error: "GitHub repo not found. Recreate from Project Settings." |
| Repo name already exists (422) | Return error: "A repository with this name already exists in your GitHub account" |
| Project owner has no GitHub token | Sync skipped silently (no toast); GitHub tab shows "Connect GitHub to enable sync" |
| Collaborator saves, owner has token | Auto-sync proceeds using owner's token |
| Collaborator saves, owner has no token | Sync skipped silently; owner can manually sync from settings |
| Partial init failure | `github_repo_url` saved immediately on repo creation; retry resumes from failure point |
| GitHub rate limit (429) | Return error with message including retry-after header value |

---

## Out of Scope

- Sync from GitHub back to Solomon (one-way only)
- GitHub Projects boards (kanban)
- PR creation or branch management
- Webhook-based inbound sync
- Closing/deleting GitHub milestones or issues when Solomon items are deleted
