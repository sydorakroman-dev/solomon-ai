# Design: Settings Navigation Restructure

**Date:** 2026-03-11
**Status:** Approved

---

## Overview

Split the current single `/settings` page into three separate pages, each with a dedicated URL. Add a persistent "Settings" group to the sidebar that is always visible regardless of whether the user is in a project context. Admin-only pages are hidden from non-admin users in the sidebar and redirect non-admins at the page level.

---

## Pages

| Route | Page Title | Accessible To | Content |
|-------|-----------|---------------|---------|
| `/profile` | Profile Settings | All users | Full name, email address change, password change |
| `/settings` | System Settings | Admins only | AI provider API keys, model selector, system prompts |
| `/user-management` | User Management | Admins only | User list and role management (current `/admin` content) |

Non-admins who navigate directly to `/settings` or `/user-management` are redirected to `/profile`.

---

## Sidebar

A new "Settings" group is pinned at the bottom of the sidebar, rendered in all contexts (dashboard level and project level alike). The group appears below the project nav items when inside a project.

```
[Project nav items when in project context]

─── Settings ───────────────────────────
  Profile                    (always shown)
  System Settings            (admin only)
  User Management            (admin only)
```

- Non-admins see only "Profile" in the group.
- Admin-only items are hidden (not disabled) for non-admins.
- The existing top-level "System Settings" dashboard nav link is removed; the Settings group replaces it.

---

## Content Split

**`/profile` (new page):**
- Display Name form (full name via `profiles` table)
- Email Address form (current email shown, new email input, confirmation flow)
- Password form (current password, new password, confirm)
- Extracted from the current Profile tab in `/settings`

**`/settings` (updated — admin only):**
- AI Providers card (Anthropic, OpenAI, Gemini, Voyage API keys with show/hide)
- Active model dropdown (live-fetched, grouped by provider)
- System Prompts section (5 stages, admin edit)
- Extracted from the current AI Settings tab in `/settings`
- Add server-side admin guard: redirect to `/profile` if not admin

**`/user-management` (renamed from `/admin`):**
- Existing admin page content, with one removal: the "System Prompts" tab is deleted from this page (System Prompts now live exclusively in `/settings`)
- Add server-side admin guard (same pattern as `/admin` already has)

---

## Admin Access Control

The dashboard `layout.tsx` already fetches `profiles.role` and passes it to Sidebar as a prop. No new data fetching is needed.

- **Sidebar:** renders Settings group items conditionally based on `role` prop (already available).
- **Page-level guard for `/settings`:** The current `settings/page.tsx` is a `'use client'` component with a client-side admin probe. Convert it to a **Server Component** (remove `'use client'`, move data fetching server-side) so a server-side `redirect('/profile')` can fire before the page renders for non-admins. The existing client-side `isAdmin` probe against `/api/admin/users` becomes redundant once the server guard is in place and should be removed — System Prompts editing is always available since only admins can reach the page. API calls (`/api/settings`, `/api/system-prompts`, `/api/models`) continue to work as before; initial data can be server-fetched and passed as props to a `'use client'` child component if needed for interactivity.
- **Page-level guard for `/user-management`:** Already a Server Component — add the same role check and `redirect('/profile')` at the top, matching the pattern in `layout.tsx`.
- **`/admin` redirect:** Replace the existing `admin/page.tsx` content with a simple Server Component that calls `redirect('/user-management')`.
- **`/profile`:** No guard needed. Authentication is already handled by the dashboard layout. Implement as a pure `'use client'` component (same pattern as the current Profile tab), fetching `/api/profile` on mount via `useEffect`.


---

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| New | `src/app/(dashboard)/profile/page.tsx` | Profile Settings page (name, email, password) |
| Modify | `src/app/(dashboard)/settings/page.tsx` | System Settings — remove Profile tab, add admin guard |
| New | `src/app/(dashboard)/user-management/page.tsx` | User Management — copy of current admin page |
| Modify (replace content) | `src/app/(dashboard)/admin/page.tsx` | Redirect `/admin` → `/user-management` (replace existing 300-line component with a single `redirect()` call) |
| Modify | `src/components/layout/Sidebar.tsx` | Add persistent Settings group at bottom |
| Modify | `src/app/(dashboard)/layout.tsx` | Remove old "System Settings" top-level nav link |

---

## Error Handling

- Non-admin accessing `/settings` or `/user-management` → server-side `redirect('/profile')`
- `/admin` → `redirect('/user-management')` (permanent, no flash)
- Profile page accessible to all authenticated users (layout already handles unauthenticated redirect)
