# Design: Project Member Invitations
**Date:** 2026-03-06
**Status:** Approved

## Summary

Allow the project owner to invite collaborators to a project via email. Invited users get viewer or editor access. Unregistered users receive a Supabase magic-link invite email; once they register, pending invitations are auto-accepted on first login.

---

## Database

### New table: `project_members`
Active collaborators on a project.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | cascade delete |
| `user_id` | uuid FK → auth.users | cascade delete |
| `role` | text | `viewer \| editor` |
| `invited_by` | uuid FK → auth.users | nullable, set null on delete |
| `created_at` | timestamptz | |

Unique constraint on `(project_id, user_id)`.

### New table: `project_invitations`
Pending invites for unregistered (or not-yet-joined) users.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | cascade delete |
| `email` | text | |
| `role` | text | `viewer \| editor` |
| `invited_by` | uuid FK → auth.users | cascade delete |
| `status` | text | `pending \| accepted` |
| `created_at` | timestamptz | |

Unique constraint on `(project_id, email)`.

### RLS additions
All project-related tables get a second SELECT (and ALL for editors) policy allowing access when `auth.uid()` is in `project_members` for that project:

- `projects`
- `data_sources`
- `project_charter`
- `prd`
- `epics`
- `user_stories`
- `project_prompts`

RLS on new tables:
- `project_members`: owner can manage all; member can see their own row
- `project_invitations`: owner can manage all

---

## Invite Flow

1. Owner opens **Project Settings → Members tab**
2. Enters email + selects role (viewer/editor), clicks **Invite**
3. `POST /api/projects/[id]/invite` is called:
   - If user exists in `auth.users` by email → insert into `project_members` directly
   - If user does not exist → insert into `project_invitations` (status=pending) + call `supabase.auth.admin.inviteUserByEmail(email)`
4. UI refreshes members list and shows pending invitations

**Auto-accept on login:**
Dashboard server layout (`src/app/(dashboard)/layout.tsx`) calls a helper after auth check that:
1. Queries `project_invitations` WHERE `email = user.email AND status = 'pending'`
2. For each: inserts into `project_members`, updates invitation status to `accepted`
This runs server-side on every dashboard navigation, negligible cost.

---

## API Routes

| Method | Route | Description |
|---|---|---|
| GET | `/api/projects/[id]/members` | List members + pending invitations |
| POST | `/api/projects/[id]/invite` | Invite by email + role (owner only) |
| PATCH | `/api/projects/[id]/members/[userId]` | Change member role (owner only) |
| DELETE | `/api/projects/[id]/members/[userId]` | Remove member (owner only) |
| DELETE | `/api/projects/[id]/invitations/[invId]` | Cancel pending invitation (owner only) |

---

## UI

### Project Settings page
Gains a top-level **tabs** layout with two tabs:
- **Members** (new, shown first)
- **Prompts** (existing content moved here)

### Members tab
- **Invite form**: email input + role select (viewer/editor) + Invite button
- **Active members list**: name/email, role badge (dropdown to change), remove button; owner shown at top, cannot be removed
- **Pending invitations**: email, role badge, Cancel button

---

## Files to Create/Modify

### New
- `supabase/migrations/004_project_members.sql`
- `src/app/api/projects/[id]/members/route.ts`
- `src/app/api/projects/[id]/invite/route.ts`
- `src/app/api/projects/[id]/members/[userId]/route.ts`
- `src/app/api/projects/[id]/invitations/[invId]/route.ts`
- `src/components/project/ProjectMembersPanel.tsx`

### Modified
- `src/app/(dashboard)/layout.tsx` — auto-accept pending invitations
- `src/app/(dashboard)/project/[id]/settings/page.tsx` — add Members tab
- `src/app/(dashboard)/project/[id]/layout.tsx` — allow member access (not just owner)
- `src/types/index.ts` — add `ProjectMember`, `ProjectInvitation` types
