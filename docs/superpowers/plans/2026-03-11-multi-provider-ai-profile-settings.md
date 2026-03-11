# Multi-Provider AI & Profile Settings Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI and Google Gemini as AI providers (alongside Anthropic) with live model fetching, and add a Profile tab to settings for email/password/name changes.

**Architecture:** A new `providers.ts` abstraction routes `generateText()` calls to the correct SDK based on a `provider:model-id` string format. All five AI routes are updated to use this function. Two new API routes handle model listing (`/api/models`) and profile updates (`/api/profile`). The settings page gains new API key fields, a live model dropdown, and a Profile tab.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Auth, `openai` SDK, `@google/generative-ai` SDK, `@anthropic-ai/sdk` (existing), Vitest

**Spec:** `docs/superpowers/specs/2026-03-11-multi-provider-ai-profile-settings-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/ai/client.ts` | Update `DEFAULT_MODEL` to use `anthropic:` prefix |
| New | `src/lib/ai/providers.ts` | `parseModel()` + `generateText()` abstraction |
| New | `src/app/api/models/route.ts` | Live model list from all configured providers |
| New | `src/app/api/profile/route.ts` | Email / password / name updates via Supabase Auth |
| Modify | `src/app/api/settings/route.ts` | Add `openai_api_key`, `gemini_api_key` fields |
| Modify | `src/app/api/ai/charter/route.ts` | Use `generateText()` |
| Modify | `src/app/api/ai/prd/route.ts` | Use `generateText()` |
| Modify | `src/app/api/ai/epics/route.ts` | Use `generateText()` |
| Modify | `src/app/api/ai/stories/route.ts` | Use `generateText()` |
| Modify | `src/app/api/ai/domain-research/route.ts` | Use `generateText()` |
| Modify | `src/types/index.ts` | Add `openai_api_key`, `gemini_api_key` to `UserSettings` |
| Modify | `src/app/(dashboard)/settings/page.tsx` | Profile tab, new API key fields, live model dropdown |
| New | `supabase/migrations/006_multi_provider_settings.sql` | Add `openai_api_key`, `gemini_api_key` columns |
| Modify | `src/test/api-logic.test.ts` | Tests for `parseModel()` |

---

## Chunk 1: Core Backend — Providers Abstraction & AI Routes

### Task 1: Install packages

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install OpenAI and Google AI SDKs**

```bash
npm install openai @google/generative-ai
```

- [ ] **Step 2: Verify**

```bash
node -e "require('openai'); require('@google/generative-ai'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add openai and @google/generative-ai SDKs"
```

---

### Task 2: parseModel — TDD

**Files:**
- New: `src/lib/ai/providers.ts`
- Modify: `src/test/api-logic.test.ts`

The `parseModel` function is a pure function: given a model string, return `{ provider, modelId }`. Bare strings (no colon) are treated as `anthropic`.

- [ ] **Step 1: Add failing tests at the bottom of `src/test/api-logic.test.ts`**

```ts
// ──────────────────────────────────────────────────────────────
// parseModel (from src/lib/ai/providers.ts)
// ──────────────────────────────────────────────────────────────

function parseModel(model: string): { provider: string; modelId: string } {
  const colonIdx = model.indexOf(':')
  if (colonIdx === -1) return { provider: 'anthropic', modelId: model }
  return { provider: model.slice(0, colonIdx), modelId: model.slice(colonIdx + 1) }
}

describe('parseModel', () => {
  it('parses anthropic prefix', () => {
    expect(parseModel('anthropic:claude-sonnet-4-6')).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' })
  })

  it('parses openai prefix', () => {
    expect(parseModel('openai:gpt-4o')).toEqual({ provider: 'openai', modelId: 'gpt-4o' })
  })

  it('parses google prefix', () => {
    expect(parseModel('google:gemini-2.0-flash')).toEqual({ provider: 'google', modelId: 'gemini-2.0-flash' })
  })

  it('treats bare string (no colon) as anthropic — backwards compat', () => {
    expect(parseModel('claude-sonnet-4-6')).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' })
  })

  it('handles model ids that contain colons (takes first colon as separator)', () => {
    expect(parseModel('openai:ft:gpt-4:custom')).toEqual({ provider: 'openai', modelId: 'ft:gpt-4:custom' })
  })
})
```

- [ ] **Step 2: Run to verify tests pass** (they use inline function, not the real file yet — just verifying the logic)

```bash
npx vitest run src/test/api-logic.test.ts
```

Expected: PASS (inline function matches the spec logic)

- [ ] **Step 3: Create `src/lib/ai/providers.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'

export interface GenerateOptions {
  model: string
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  apiKeys: {
    anthropic?: string | null
    openai?: string | null
    gemini?: string | null
  }
}

export function parseModel(model: string): { provider: string; modelId: string } {
  const colonIdx = model.indexOf(':')
  if (colonIdx === -1) return { provider: 'anthropic', modelId: model }
  return { provider: model.slice(0, colonIdx), modelId: model.slice(colonIdx + 1) }
}

export async function generateText(options: GenerateOptions): Promise<string> {
  const { provider, modelId } = parseModel(options.model)

  if (provider === 'anthropic') {
    if (!options.apiKeys.anthropic) {
      throw new Error('No API key configured for Anthropic. Add it in Settings.')
    }
    const client = new Anthropic({ apiKey: options.apiKeys.anthropic })
    const message = await client.messages.create({
      model: modelId,
      max_tokens: options.maxTokens,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: options.userPrompt }],
    })
    return message.content[0].type === 'text' ? message.content[0].text : ''
  }

  if (provider === 'openai') {
    if (!options.apiKeys.openai) {
      throw new Error('No API key configured for OpenAI. Add it in Settings.')
    }
    const client = new OpenAI({ apiKey: options.apiKeys.openai })
    const completion = await client.chat.completions.create({
      model: modelId,
      max_tokens: options.maxTokens,
      messages: [
        ...(options.systemPrompt ? [{ role: 'system' as const, content: options.systemPrompt }] : []),
        { role: 'user', content: options.userPrompt },
      ],
    })
    return completion.choices[0]?.message?.content ?? ''
  }

  if (provider === 'google') {
    if (!options.apiKeys.gemini) {
      throw new Error('No API key configured for Google Gemini. Add it in Settings.')
    }
    const genAI = new GoogleGenerativeAI(options.apiKeys.gemini)
    const geminiModel = genAI.getGenerativeModel({
      model: modelId,
      systemInstruction: options.systemPrompt || undefined,
    })
    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: options.userPrompt }] }],
      generationConfig: { maxOutputTokens: options.maxTokens },
    })
    return result.response.text()
  }

  throw new Error(`Unknown AI provider: "${provider}". Expected anthropic, openai, or google.`)
}
```

- [ ] **Step 4: Update the test to import `parseModel` from `providers.ts` (remove inline copy)**

In `src/test/api-logic.test.ts`, replace the inline `parseModel` function added in Step 1 with a real import:

```ts
// At the top of the file (with other imports):
import { parseModel } from '@/lib/ai/providers'
```

Then delete the inline `function parseModel(...)` block that was added in Step 1. The `describe('parseModel', ...)` block below it should remain as-is — it now tests the real implementation.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: No errors

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/providers.ts src/test/api-logic.test.ts
git commit -m "feat: add generateText provider abstraction with parseModel"
```

---

### Task 3: Update DEFAULT_MODEL in client.ts

**Files:**
- Modify: `src/lib/ai/client.ts`

- [ ] **Step 1: Update `DEFAULT_MODEL` to use the `anthropic:` prefix**

Open `src/lib/ai/client.ts`. Change line 7 from:
```ts
export const DEFAULT_MODEL = 'claude-sonnet-4-6'
```
to:
```ts
export const DEFAULT_MODEL = 'anthropic:claude-sonnet-4-6'
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/client.ts
git commit -m "fix: update DEFAULT_MODEL to use anthropic: prefix"
```

---

### Task 4: Database migration

**Files:**
- New: `supabase/migrations/006_multi_provider_settings.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add OpenAI and Google Gemini API key columns to user_settings
alter table public.user_settings
  add column if not exists openai_api_key text,
  add column if not exists gemini_api_key text;
```

Save to `supabase/migrations/006_multi_provider_settings.sql`.

- [ ] **Step 2: Apply migration in Supabase Dashboard**

Go to: https://supabase.com/dashboard/project/cierdqlzzfiwsclxhram/sql/new

Paste and run:
```sql
alter table public.user_settings
  add column if not exists openai_api_key text,
  add column if not exists gemini_api_key text;
```

Expected: Success, no errors.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/006_multi_provider_settings.sql
git commit -m "feat: add openai_api_key and gemini_api_key to user_settings"
```

---

### Task 5: Update UserSettings type and settings API

**Files:**
- Modify: `src/types/index.ts:191-197`
- Modify: `src/app/api/settings/route.ts`

- [ ] **Step 1: Add new fields to `UserSettings` in `src/types/index.ts`**

Find the `UserSettings` interface (currently lines 191-197) and update it:

```ts
export interface UserSettings {
  user_id: string
  anthropic_api_key: string | null
  openai_api_key: string | null
  gemini_api_key: string | null
  voyage_api_key: string | null
  model: string
}
```

- [ ] **Step 2: Update `src/app/api/settings/route.ts`**

Replace the entire file with:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data ?? {
    user_id: user.id,
    anthropic_api_key: null,
    openai_api_key: null,
    gemini_api_key: null,
    voyage_api_key: null,
    model: 'anthropic:claude-sonnet-4-6',
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { anthropic_api_key, openai_api_key, gemini_api_key, voyage_api_key, model } = body

  const { data, error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: user.id,
      anthropic_api_key: anthropic_api_key?.trim() || null,
      openai_api_key: openai_api_key?.trim() || null,
      gemini_api_key: gemini_api_key?.trim() || null,
      voyage_api_key: voyage_api_key?.trim() || null,
      model: model ?? 'anthropic:claude-sonnet-4-6',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/app/api/settings/route.ts
git commit -m "feat: add openai/gemini keys to UserSettings type and settings API"
```

---

### Task 6: Update all 5 AI routes to use generateText

**Files:**
- Modify: `src/app/api/ai/charter/route.ts`
- Modify: `src/app/api/ai/prd/route.ts`
- Modify: `src/app/api/ai/epics/route.ts`
- Modify: `src/app/api/ai/stories/route.ts`
- Modify: `src/app/api/ai/domain-research/route.ts`

All five routes follow the same pattern. The changes are identical in structure:

**For each route:**

1. Replace `import { createAnthropicClient } from '@/lib/ai/client'` with `import { generateText } from '@/lib/ai/providers'`

2. Change the settings select from `'anthropic_api_key, model'` to `'anthropic_api_key, openai_api_key, gemini_api_key, model'`

3. Remove the `if (!settings?.anthropic_api_key)` check block entirely — `generateText` will throw with a descriptive error if a key is missing.

4. Replace the SDK call block. Currently each route has:
```ts
const anthropic = createAnthropicClient(settings.anthropic_api_key)
const message = await anthropic.messages.create({
  model: settings.model ?? 'claude-sonnet-4-6',
  max_tokens: NNNN,
  system: systemInstruction,
  messages: [{ role: 'user', content: userMessage }],
})
const content = message.content[0].type === 'text' ? message.content[0].text : ''
```

Replace with:
```ts
const content = await generateText({
  model: settings.model ?? 'anthropic:claude-sonnet-4-6',
  systemPrompt: systemInstruction,
  userPrompt: userMessage,
  maxTokens: NNNN,
  apiKeys: {
    anthropic: settings.anthropic_api_key,
    openai: settings.openai_api_key,
    gemini: settings.gemini_api_key,
  },
})
```

Where `NNNN` is the existing `max_tokens` value for that route:
- charter: `4000`
- prd: `6000`
- epics: `3000`
- stories: `4000`
- domain-research: `2000`

Note: the variable holding the prompt may be named `userMessage` or `prompt` depending on the route — use whatever name exists in that file.

5. Update the catch block to return `status: 400` instead of `status: 500`, so missing-key errors from `generateText` are surfaced as client errors (not server errors):
```ts
} catch (err) {
  return NextResponse.json({ error: err instanceof Error ? err.message : 'AI generation failed' }, { status: 400 })
}
```

- [ ] **Step 1: Update `src/app/api/ai/charter/route.ts`** — apply the 5 changes above (max_tokens: 4000)

- [ ] **Step 2: Update `src/app/api/ai/prd/route.ts`** — apply the 5 changes (max_tokens: 6000)

- [ ] **Step 3: Update `src/app/api/ai/epics/route.ts`** — apply the 5 changes (max_tokens: 3000)

- [ ] **Step 4: Update `src/app/api/ai/stories/route.ts`** — apply the 5 changes (max_tokens: 4000)

- [ ] **Step 5: Update `src/app/api/ai/domain-research/route.ts`** — apply the 5 changes (max_tokens: 2000)

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No errors

- [ ] **Step 7: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/app/api/ai/
git commit -m "feat: update all AI routes to use provider-agnostic generateText"
```

---

## Chunk 2: New API Routes

### Task 7: Create /api/models route

**Files:**
- New: `src/app/api/models/route.ts`

This route reads the user's stored API keys, fetches models from each configured provider, and returns a combined list. Failures from any provider are silently swallowed (that provider is excluded).

- [ ] **Step 1: Create `src/app/api/models/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

interface ModelOption {
  value: string
  label: string
  provider: string
}

const ANTHROPIC_MODELS: ModelOption[] = [
  { value: 'anthropic:claude-sonnet-4-6',       label: 'Claude Sonnet 4.6',  provider: 'Anthropic' },
  { value: 'anthropic:claude-opus-4-6',          label: 'Claude Opus 4.6',    provider: 'Anthropic' },
  { value: 'anthropic:claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  provider: 'Anthropic' },
]

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: settings } = await supabase
    .from('user_settings')
    .select('anthropic_api_key, openai_api_key, gemini_api_key')
    .eq('user_id', user.id)
    .single()

  const models: ModelOption[] = []

  // Anthropic — curated list (no public models API)
  if (settings?.anthropic_api_key) {
    models.push(...ANTHROPIC_MODELS)
  }

  // OpenAI — live fetch
  if (settings?.openai_api_key) {
    try {
      const client = new OpenAI({ apiKey: settings.openai_api_key })
      const response = await client.models.list()
      let chatModels = response.data.filter(m => /^(gpt-|o1|o3)/.test(m.id))
      if (chatModels.length === 0) chatModels = response.data // fallback: show all
      chatModels
        .sort((a, b) => b.id.localeCompare(a.id))
        .forEach(m => models.push({ value: `openai:${m.id}`, label: m.id, provider: 'OpenAI' }))
    } catch {
      // invalid key or network error — silently exclude OpenAI
    }
  }

  // Google Gemini — live fetch
  if (settings?.gemini_api_key) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${settings.gemini_api_key}`
      )
      if (res.ok) {
        const data = await res.json() as {
          models?: Array<{ name: string; displayName: string; supportedGenerationMethods: string[] }>
        }
        ;(data.models ?? [])
          .filter(m => m.supportedGenerationMethods.includes('generateContent'))
          .forEach(m => {
            const modelId = m.name.replace('models/', '')
            models.push({ value: `google:${modelId}`, label: m.displayName, provider: 'Google' })
          })
      }
    } catch {
      // invalid key or network error — silently exclude Google
    }
  }

  return NextResponse.json(models)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/models/route.ts
git commit -m "feat: add /api/models route for live provider model listing"
```

---

### Task 8: Create /api/profile route

**Files:**
- New: `src/app/api/profile/route.ts`

This route handles three independent profile update operations: full name, email, and password. Each is triggered by which fields are present in the request body.

- [ ] **Step 1: Create `src/app/api/profile/route.ts`**

Use `createAdminClient` (service role) for auth mutations per spec. The project already exports `createAdminClient` from `@/lib/supabase/server`.

```ts
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const body = await request.json()
  const { full_name, email, password, current_password } = body

  // Update full name
  if (full_name !== undefined) {
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: full_name?.trim() || null })
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!email && !password) return NextResponse.json({ message: 'Name updated' })
  }

  // Update email (admin client bypasses session constraints for server-side update)
  if (email) {
    const { error } = await admin.auth.admin.updateUserById(user.id, { email })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ message: 'Check your inbox to confirm the new email address.' })
  }

  // Update password
  if (password) {
    if (!current_password) {
      return NextResponse.json({ error: 'Current password is required' }, { status: 400 })
    }
    // Verify current password first using anon client (requires valid session)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: current_password,
    })
    if (signInError) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }
    const { error } = await admin.auth.admin.updateUserById(user.id, { password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ message: 'Password updated successfully' })
  }

  return NextResponse.json({ message: 'Profile updated' })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: No errors

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/api/profile/route.ts
git commit -m "feat: add /api/profile route for email/password/name updates"
```

---

## Chunk 3: Frontend — Settings Page

### Task 9: Update settings page

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`

This task replaces the entire settings page. The current page has: API keys form + System Prompts section. After: outer tabs (Profile | AI Settings), with AI Settings containing the updated keys + live model dropdown, and Profile containing name/email/password forms.

The current page file is 246 lines. Read it fully before editing. The key structural changes:
- Wrap everything in two outer tabs: `"profile"` and `"ai"`
- Add `openai_api_key` and `gemini_api_key` fields to the AI settings form state
- Replace hardcoded `MODELS` array with a live-fetched list from `GET /api/models`
- Group models by provider using `SelectGroup` / `SelectLabel` in the dropdown
- Add Profile tab content: full name, email change, password change (three separate mini-forms)

- [ ] **Step 1: Replace `src/app/(dashboard)/settings/page.tsx` with the following**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Eye, EyeOff } from 'lucide-react'

interface ModelOption {
  value: string
  label: string
  provider: string
}

const STAGES: { key: string; label: string; description: string }[] = [
  { key: 'charter',         label: 'Charter',        description: 'Guides AI when generating the Project Charter from source documents.' },
  { key: 'prd',             label: 'PRD',             description: 'Guides AI when generating the Product Requirements Document.' },
  { key: 'epics',           label: 'Epics',           description: 'Guides AI when breaking the PRD into Epics.' },
  { key: 'stories',         label: 'Stories',         description: 'Guides AI when generating User Stories from Epics.' },
  { key: 'domain_research', label: 'Domain Research', description: 'Guides the Domain Research Agent when synthesising industry knowledge.' },
]

type SystemPrompts = Record<string, string>

function KeyInput({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  placeholder: string
  onChange: (v: string) => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  // AI settings form
  const [form, setForm] = useState({
    anthropic_api_key: '',
    openai_api_key: '',
    gemini_api_key: '',
    voyage_api_key: '',
    model: 'anthropic:claude-sonnet-4-6',
  })
  const [models, setModels] = useState<ModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

  // System prompts
  const [prompts, setPrompts] = useState<SystemPrompts>({})
  const [savingStage, setSavingStage] = useState<string | null>(null)

  // Profile form
  const [currentEmail, setCurrentEmail] = useState('')
  const [profileName, setProfileName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [savingPassword, setSavingPassword] = useState(false)

  async function fetchModels() {
    setLoadingModels(true)
    try {
      const res = await fetch('/api/models')
      if (res.ok) setModels(await res.json())
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/system-prompts').then(r => r.json()),
      fetch('/api/admin/users').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([settings, systemPrompts, adminCheck]) => {
      setForm({
        anthropic_api_key: settings.anthropic_api_key ?? '',
        openai_api_key: settings.openai_api_key ?? '',
        gemini_api_key: settings.gemini_api_key ?? '',
        voyage_api_key: settings.voyage_api_key ?? '',
        model: settings.model ?? 'anthropic:claude-sonnet-4-6',
      })
      // Note: current email is fetched separately via GET /api/profile below
      if (Array.isArray(systemPrompts)) {
        const map: SystemPrompts = {}
        for (const p of systemPrompts) map[p.stage] = p.content
        setPrompts(map)
      }
      setIsAdmin(Array.isArray(adminCheck))
    }).finally(() => setLoading(false))

    // Fetch current user email from auth
    fetch('/api/profile').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.email) setCurrentEmail(data.email)
      if (data?.full_name) setProfileName(data.full_name ?? '')
    }).catch(() => null)

    fetchModels()
  }, [])

  async function handleSaveAI(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Settings saved')
      await fetchModels() // refresh model list after saving new keys
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePrompt(stage: string) {
    setSavingStage(stage)
    try {
      const res = await fetch('/api/system-prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, content: prompts[stage] ?? '' }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Prompt saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save prompt')
    } finally {
      setSavingStage(null)
    }
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    setSavingName(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: profileName }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Name updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update name')
    } finally {
      setSavingName(false)
    }
  }

  async function handleSaveEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail) return
    setSavingEmail(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(data.message)
      setNewEmail('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update email')
    } finally {
      setSavingEmail(false)
    }
  }

  async function handleSavePassword(e: React.FormEvent) {
    e.preventDefault()
    if (passwordForm.next !== passwordForm.confirm) {
      toast.error('Passwords do not match')
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordForm.next, current_password: passwordForm.current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(data.message)
      setPasswordForm({ current: '', next: '', confirm: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setSavingPassword(false)
    }
  }

  // Group models by provider for the select dropdown
  const modelsByProvider = models.reduce<Record<string, ModelOption[]>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = []
    acc[m.provider].push(m)
    return acc
  }, {})

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-0.5">Manage your profile, AI providers, and generation prompts</p>
      </div>

      <Tabs defaultValue="ai">
        <TabsList className="mb-6">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="ai">AI Settings</TabsTrigger>
        </TabsList>

        {/* ── Profile Tab ── */}
        <TabsContent value="profile" className="space-y-6">

          {/* Full name */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Display Name</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveName} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="full_name">Full name</Label>
                  <Input
                    id="full_name"
                    placeholder="Your name"
                    value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                  />
                </div>
                <Button type="submit" size="sm" disabled={savingName}>
                  {savingName ? 'Saving...' : 'Save name'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Email */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Email Address</CardTitle>
              <CardDescription>
                Current email: <span className="font-medium text-foreground">{currentEmail || '—'}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveEmail} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new_email">New email address</Label>
                  <Input
                    id="new_email"
                    type="email"
                    placeholder="new@example.com"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                  />
                </div>
                <Button type="submit" size="sm" disabled={savingEmail || !newEmail}>
                  {savingEmail ? 'Sending...' : 'Send confirmation email'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  You will receive a confirmation email at the new address. The change takes effect after you confirm.
                </p>
              </form>
            </CardContent>
          </Card>

          {/* Password */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Password</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSavePassword} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="current_password">Current password</Label>
                  <KeyInput
                    id="current_password"
                    placeholder="Current password"
                    value={passwordForm.current}
                    onChange={v => setPasswordForm(f => ({ ...f, current: v }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new_password">New password</Label>
                  <KeyInput
                    id="new_password"
                    placeholder="New password"
                    value={passwordForm.next}
                    onChange={v => setPasswordForm(f => ({ ...f, next: v }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm_password">Confirm new password</Label>
                  <KeyInput
                    id="confirm_password"
                    placeholder="Confirm new password"
                    value={passwordForm.confirm}
                    onChange={v => setPasswordForm(f => ({ ...f, confirm: v }))}
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={savingPassword || !passwordForm.current || !passwordForm.next || !passwordForm.confirm}
                >
                  {savingPassword ? 'Updating...' : 'Update password'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AI Settings Tab ── */}
        <TabsContent value="ai">
          <form onSubmit={handleSaveAI} className="space-y-6 mb-10">

            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI Providers</CardTitle>
                <CardDescription>Add API keys to enable each provider. Your keys are stored securely and never shared.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">

                <div className="space-y-1.5">
                  <Label htmlFor="anthropic_key">Anthropic API Key</Label>
                  <KeyInput
                    id="anthropic_key"
                    placeholder="sk-ant-..."
                    value={form.anthropic_api_key}
                    onChange={v => setForm(f => ({ ...f, anthropic_api_key: v }))}
                  />
                  <p className="text-xs text-muted-foreground">Claude models (Sonnet, Opus, Haiku)</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="openai_key">OpenAI API Key</Label>
                  <KeyInput
                    id="openai_key"
                    placeholder="sk-..."
                    value={form.openai_api_key}
                    onChange={v => setForm(f => ({ ...f, openai_api_key: v }))}
                  />
                  <p className="text-xs text-muted-foreground">GPT-4o, o1, o3 and other OpenAI models</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="gemini_key">Google Gemini API Key</Label>
                  <KeyInput
                    id="gemini_key"
                    placeholder="AIza..."
                    value={form.gemini_api_key}
                    onChange={v => setForm(f => ({ ...f, gemini_api_key: v }))}
                  />
                  <p className="text-xs text-muted-foreground">Gemini 2.0 Flash, Pro and other Gemini models</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="model">Active model</Label>
                  <Select
                    value={form.model}
                    onValueChange={v => setForm(f => ({ ...f, model: v }))}
                    disabled={loadingModels || models.length === 0}
                  >
                    <SelectTrigger id="model">
                      <SelectValue placeholder={
                        loadingModels ? 'Loading models...' : 'Add an API key above to see models'
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(modelsByProvider).map(([provider, providerModels]) => (
                        <SelectGroup key={provider}>
                          <SelectLabel>{provider}</SelectLabel>
                          {providerModels.map(m => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {models.length === 0 && !loadingModels && (
                    <p className="text-xs text-muted-foreground">Add at least one API key and save to see available models.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vector Embeddings</CardTitle>
                <CardDescription>
                  Used to semantically index your sources in Supabase. Get a free key at{' '}
                  <a href="https://www.voyageai.com" target="_blank" rel="noopener noreferrer" className="underline">
                    voyageai.com
                  </a>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  <Label htmlFor="voyage_key">Voyage AI API Key</Label>
                  <KeyInput
                    id="voyage_key"
                    placeholder="pa-..."
                    value={form.voyage_api_key}
                    onChange={v => setForm(f => ({ ...f, voyage_api_key: v }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional — sources are saved without embeddings if not set
                  </p>
                </div>
              </CardContent>
            </Card>

            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save settings'}
            </Button>
          </form>

          {/* System Prompts */}
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">System Prompts</h2>
              <p className="text-muted-foreground text-sm mt-0.5">
                Default AI instructions used at each pipeline stage. Applied globally across all projects.
                {!isAdmin && <span className="text-amber-600 ml-1">— read-only (admin only)</span>}
              </p>
            </div>

            <Tabs defaultValue="charter">
              <TabsList className="mb-4">
                {STAGES.map(s => (
                  <TabsTrigger key={s.key} value={s.key}>{s.label}</TabsTrigger>
                ))}
              </TabsList>

              {STAGES.map(s => (
                <TabsContent key={s.key} value={s.key}>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">{s.label} Prompt</CardTitle>
                      <CardDescription>{s.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Textarea
                        value={prompts[s.key] ?? ''}
                        onChange={e => setPrompts(p => ({ ...p, [s.key]: e.target.value }))}
                        rows={8}
                        className="font-mono text-sm resize-y"
                        disabled={!isAdmin}
                        placeholder={isAdmin ? 'Enter system prompt...' : 'No prompt set'}
                      />
                      {isAdmin && (
                        <Button
                          size="sm"
                          onClick={() => handleSavePrompt(s.key)}
                          disabled={savingStage === s.key}
                        >
                          {savingStage === s.key ? 'Saving...' : `Save ${s.label} prompt`}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

Note: The profile tab calls `GET /api/profile` on load to fetch the current email and name. This requires adding a `GET` handler to `/api/profile/route.ts` — see the next step.

- [ ] **Step 2: Add `GET` handler to `/api/profile/route.ts`**

Add before the existing `PATCH` export in `src/app/api/profile/route.ts`:

```ts
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({
    email: user.email,
    full_name: profile?.full_name ?? null,
  })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No errors

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | tail -15
```

Expected: Build succeeds, all routes compiled

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/settings/page.tsx src/app/api/profile/route.ts
git commit -m "feat: update settings page with multi-provider keys, live models, and Profile tab"
```
