# Call Transcript & Spreadsheet Upload Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Call Transcript source (file upload or paste) and a Spreadsheet source type (CSV/XLSX/XLS with full multi-sheet extraction).

**Architecture:** Two new extraction functions added to `src/lib/utils/files.ts` (`extractDocxText` via `mammoth`, `extractSpreadsheet` via `xlsx`). The API route gains new file-type branches. On the frontend, a new `CallTranscriptForm` component unifies file upload and text paste; `FileUploadForm` gains a spreadsheet option.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase, Vitest, `mammoth` (DOCX), `xlsx` / SheetJS (CSV/XLSX)

**Spec:** `docs/superpowers/specs/2026-03-10-transcript-and-spreadsheet-upload-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/types/index.ts` | Add `'spreadsheet'` to `SourceType` union |
| Modify | `src/lib/utils/files.ts` | Add `extractDocxText()` and `extractSpreadsheet()` |
| Modify | `src/test/files.test.ts` | Tests for both new extraction functions |
| Modify | `src/app/api/sources/route.ts` | Handle `.docx` and spreadsheet files in `handleFileUpload` |
| Create | `src/components/sources/CallTranscriptForm.tsx` | Unified form: Upload tab + Paste tab |
| Modify | `src/components/sources/AddSourceDialog.tsx` | Add `call_transcript` entry to SOURCE_TYPES dropdown |
| Modify | `src/components/sources/FileUploadForm.tsx` | Add `spreadsheet` to FILE_TYPES list |

---

## Chunk 1: Backend — Extraction Utilities & API

### Task 1: Install packages

**Files:**
- Modify: `package.json` (automatic via npm)

- [ ] **Step 1: Install mammoth and xlsx**

```bash
npm install mammoth xlsx
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('mammoth'); require('xlsx'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add mammoth and xlsx dependencies"
```

---

### Task 2: extractDocxText — test then implement

**Files:**
- Modify: `src/lib/utils/files.ts`
- Modify: `src/test/files.test.ts`

- [ ] **Step 1: Add failing tests to `src/test/files.test.ts`**

The file already has `// @vitest-environment node` at the top. Add a mock for `mammoth` immediately after the existing `vi.mock('pdf-parse', ...)` block, and add a new describe block at the end of the file.

Use `require` (not `await import`) for all module access in this test file — the other tests in the file already use `require`, and mixing ESM dynamic imports with CJS requires in the same Vitest node-environment file causes module cache inconsistencies.

```ts
vi.mock('mammoth', () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: '  Call transcript text.  ' }),
}))
```

```ts
describe('extractDocxText', () => {
  it('extracts and trims text from a DOCX buffer', async () => {
    const { extractDocxText } = require('@/lib/utils/files')
    const result = await extractDocxText(Buffer.from('fake-docx'))
    expect(result).toBe('Call transcript text.')
  })

  it('returns empty string when DOCX has no text', async () => {
    const mammoth = require('mammoth') as { extractRawText: ReturnType<typeof vi.fn> }
    mammoth.extractRawText.mockResolvedValueOnce({ value: '   ' })
    const { extractDocxText } = require('@/lib/utils/files')
    const result = await extractDocxText(Buffer.from('empty-docx'))
    expect(result).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/test/files.test.ts
```

Expected: FAIL — `extractDocxText is not a function`

- [ ] **Step 3: Implement `extractDocxText` in `src/lib/utils/files.ts`**

Add after the existing `extractPdfText` function:

```ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require('mammoth')

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return (result.value as string).trim()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/files.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/files.ts src/test/files.test.ts
git commit -m "feat: add extractDocxText utility for .docx call transcripts"
```

---

### Task 3: extractSpreadsheet — test then implement

**Files:**
- Modify: `src/lib/utils/files.ts`
- Modify: `src/test/files.test.ts`

- [ ] **Step 1: Add failing tests to `src/test/files.test.ts`**

Add mock for `xlsx` after the existing mocks:

```ts
vi.mock('xlsx', () => ({
  read: vi.fn().mockReturnValue({
    SheetNames: ['Sales Data'],
    Sheets: { 'Sales Data': {} },
  }),
  utils: {
    sheet_to_json: vi.fn().mockReturnValue([
      { Month: 'Jan', Revenue: '42000', Deals: '12' },
      { Month: 'Feb', Revenue: '38000', Deals: '9' },
    ]),
  },
}))
```

Add describe block at the end of the file:

```ts
describe('extractSpreadsheet', () => {
  it('formats a single sheet as a markdown table', () => {
    const { extractSpreadsheet } = require('@/lib/utils/files')
    const result = extractSpreadsheet(Buffer.from('fake-xlsx'))
    expect(result).toContain('# Sheet: Sales Data')
    expect(result).toContain('| Month | Revenue | Deals |')
    expect(result).toContain('| Jan | 42000 | 12 |')
    expect(result).toContain('| Feb | 38000 | 9 |')
  })

  it('includes separator row in markdown table', () => {
    const { extractSpreadsheet } = require('@/lib/utils/files')
    const result = extractSpreadsheet(Buffer.from('fake-xlsx'))
    expect(result).toContain('| --- |')
  })

  it('throws when all sheets are empty', () => {
    const xlsx = require('xlsx') as { utils: { sheet_to_json: ReturnType<typeof vi.fn> } }
    xlsx.utils.sheet_to_json.mockReturnValueOnce([])
    const { extractSpreadsheet } = require('@/lib/utils/files')
    expect(() => extractSpreadsheet(Buffer.from('empty'))).toThrow('Spreadsheet appears to be empty')
  })

  it('handles multiple sheets', () => {
    const xlsx = require('xlsx') as {
      read: ReturnType<typeof vi.fn>
      utils: { sheet_to_json: ReturnType<typeof vi.fn> }
    }
    xlsx.read.mockReturnValueOnce({
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: { Sheet1: {}, Sheet2: {} },
    })
    xlsx.utils.sheet_to_json
      .mockReturnValueOnce([{ A: '1' }])
      .mockReturnValueOnce([{ B: '2' }])
    const { extractSpreadsheet } = require('@/lib/utils/files')
    const result = extractSpreadsheet(Buffer.from('multi'))
    expect(result).toContain('# Sheet: Sheet1')
    expect(result).toContain('# Sheet: Sheet2')
  })

  it('notes truncated sheets when content exceeds 50000 chars', () => {
    const xlsx = require('xlsx') as {
      read: ReturnType<typeof vi.fn>
      utils: { sheet_to_json: ReturnType<typeof vi.fn> }
    }
    xlsx.read.mockReturnValueOnce({
      SheetNames: ['Big', 'Small'],
      Sheets: { Big: {}, Small: {} },
    })
    // Big sheet: rows that will produce >50000 chars
    const bigRows = Array.from({ length: 1000 }, (_, i) => ({
      Col1: 'x'.repeat(50),
      Col2: 'y'.repeat(50),
    }))
    xlsx.utils.sheet_to_json
      .mockReturnValueOnce(bigRows)
      .mockReturnValueOnce([{ Z: 'skipped' }])
    const { extractSpreadsheet } = require('@/lib/utils/files')
    const result = extractSpreadsheet(Buffer.from('big'))
    expect(result).toContain('additional sheet')
    expect(result).toContain('truncated')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/test/files.test.ts
```

Expected: FAIL — `extractSpreadsheet is not a function`

- [ ] **Step 3: Implement `extractSpreadsheet` in `src/lib/utils/files.ts`**

Add after `extractDocxText`:

```ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx')

export function extractSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' }) as {
    SheetNames: string[]
    Sheets: Record<string, unknown>
  }

  const MAX_CHARS = 50000
  const sections: string[] = []
  let totalChars = 0
  let skipped = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }) as Record<string, unknown>[]

    if (rows.length === 0) continue

    const headers = Object.keys(rows[0])
    const headerRow = `| ${headers.join(' | ')} |`
    const separator = `| ${headers.map(() => '---').join(' | ')} |`
    const dataRows = rows.map(row =>
      `| ${headers.map(h => String(row[h] ?? '')).join(' | ')} |`
    )

    const section = `# Sheet: ${sheetName}\n${headerRow}\n${separator}\n${dataRows.join('\n')}`

    if (sections.length > 0 && totalChars + section.length > MAX_CHARS) {
      skipped++
      continue
    }

    sections.push(section)
    totalChars += section.length
  }

  if (sections.length === 0) {
    throw new Error('Spreadsheet appears to be empty')
  }

  if (skipped > 0) {
    sections.push(
      `[${skipped} additional sheet${skipped > 1 ? 's' : ''} truncated — upload separately for full coverage]`
    )
  }

  return sections.join('\n\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/files.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/files.ts src/test/files.test.ts
git commit -m "feat: add extractSpreadsheet utility for CSV/XLSX analysis"
```

---

### Task 4: Add 'spreadsheet' to SourceType

**Files:**
- Modify: `src/types/index.ts:27-36`

- [ ] **Step 1: Add `'spreadsheet'` to the SourceType union in `src/types/index.ts`**

The union currently ends with `| 'domain_knowledge'` (line 36). All other values including `'call_transcript'` already exist — **only `'spreadsheet'` is new**. Append it:

```ts
export type SourceType =
  | 'text'
  | 'pdf'
  | 'json_schema'
  | 'website'
  | 'questionnaire'
  | 'job_description_initial'
  | 'job_description_detailed'
  | 'call_transcript'
  | 'domain_knowledge'
  | 'spreadsheet'
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add spreadsheet to SourceType"
```

---

### Task 5: Update API route for .docx and spreadsheet

**Files:**
- Modify: `src/app/api/sources/route.ts:100-138`

The `handleFileUpload` function currently has three branches based on file extension: `.pdf`, `.json`, and a catch-all text branch. Add two new branches.

- [ ] **Step 1: Update imports at the top of `src/app/api/sources/route.ts`**

The import line currently reads:
```ts
import { extractPdfText, extractJsonSchema, truncateContent } from '@/lib/utils/files'
```

Change it to:
```ts
import { extractPdfText, extractDocxText, extractJsonSchema, extractSpreadsheet, truncateContent } from '@/lib/utils/files'
```

- [ ] **Step 2: Add `.docx` and spreadsheet branches inside `handleFileUpload`**

Locate the content extraction block (currently lines ~122–132):

```ts
if (file.name.endsWith('.pdf')) {
  content = truncateContent(await extractPdfText(buffer))
  metadata.file_type = 'pdf'
} else if (file.name.endsWith('.json')) {
  content = extractJsonSchema(buffer.toString('utf-8'))
  metadata.file_type = 'json'
} else {
  // Plain text / transcript
  content = truncateContent(buffer.toString('utf-8'))
  metadata.file_type = 'text'
}
```

Replace with:

```ts
if (file.name.endsWith('.pdf')) {
  content = truncateContent(await extractPdfText(buffer))
  metadata.file_type = 'pdf'
} else if (file.name.endsWith('.docx')) {
  content = truncateContent(await extractDocxText(buffer))
  metadata.file_type = 'docx'
} else if (file.name.endsWith('.json')) {
  content = extractJsonSchema(buffer.toString('utf-8'))
  metadata.file_type = 'json'
} else if (
  file.name.endsWith('.csv') ||
  file.name.endsWith('.xlsx') ||
  file.name.endsWith('.xls')
) {
  content = extractSpreadsheet(buffer)
  metadata.file_type = file.name.endsWith('.csv') ? 'csv' : 'xlsx'
  metadata.sheet_count = (content.match(/^# Sheet:/gm) ?? []).length
} else {
  // Plain text / transcript
  content = truncateContent(buffer.toString('utf-8'))
  metadata.file_type = 'text'
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sources/route.ts
git commit -m "feat: handle .docx and spreadsheet files in sources API"
```

---

## Chunk 2: Frontend — UI Components

### Task 6: Create CallTranscriptForm component

**Files:**
- Create: `src/components/sources/CallTranscriptForm.tsx`

This component has two tabs: "Upload file" and "Paste text". The upload tab accepts `.txt`, `.pdf`, `.docx`. The paste tab is a textarea. Both submit to `/api/sources` with `type: 'call_transcript'`.

- [ ] **Step 1: Create `src/components/sources/CallTranscriptForm.tsx`**

```tsx
'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { DataSource } from '@/types'

type Tab = 'upload' | 'paste'

interface Props {
  projectId: string
  onAdded: (source: DataSource) => void
}

export default function CallTranscriptForm({ projectId, onAdded }: Props) {
  const [tab, setTab] = useState<Tab>('upload')
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (tab === 'upload' && !file) return
    if (tab === 'paste' && !text.trim()) return
    setLoading(true)

    try {
      let source: DataSource

      if (tab === 'upload') {
        const formData = new FormData()
        formData.append('file', file!)
        formData.append('project_id', projectId)
        formData.append('type', 'call_transcript')
        formData.append('title', title || file!.name)
        const res = await fetch('/api/sources', { method: 'POST', body: formData })
        if (!res.ok) throw new Error((await res.json()).error)
        source = await res.json()
      } else {
        const res = await fetch('/api/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            type: 'call_transcript',
            title: title.trim() || 'Call transcript',
            content: text,
          }),
        })
        if (!res.ok) throw new Error((await res.json()).error)
        source = await res.json()
      }

      toast.success('Transcript added')
      onAdded(source)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const isDisabled = loading || (tab === 'upload' ? !file : !text.trim())

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Tab switcher */}
      <div className="flex rounded-md border border-border overflow-hidden text-sm">
        {(['upload', 'paste'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-2 font-medium transition-colors ${
              tab === t
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {t === 'upload' ? 'Upload file' : 'Paste text'}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <div className="space-y-1.5">
          <Label>File *</Label>
          <div
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-8 w-8 text-muted-foreground mb-2" />
            {file ? (
              <p className="text-sm font-medium">{file.name}</p>
            ) : (
              <>
                <p className="text-sm font-medium">Click to upload</p>
                <p className="text-xs text-muted-foreground mt-1">TXT, PDF, DOCX</p>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.pdf,.docx"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      {tab === 'paste' && (
        <div className="space-y-1.5">
          <Label htmlFor="transcript-content">Transcript *</Label>
          <Textarea
            id="transcript-content"
            placeholder="Paste your call transcript here..."
            value={text}
            onChange={e => setText(e.target.value)}
            rows={8}
            required
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="transcript-title">Title (optional)</Label>
        <Input
          id="transcript-title"
          placeholder={tab === 'upload' ? 'Uses filename if empty' : 'e.g. Discovery call – Acme Corp'}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isDisabled}>
        {loading ? 'Processing...' : 'Add transcript'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/sources/CallTranscriptForm.tsx
git commit -m "feat: add CallTranscriptForm with upload and paste tabs"
```

---

### Task 7: Add Call Transcript entry to AddSourceDialog

**Files:**
- Modify: `src/components/sources/AddSourceDialog.tsx`

- [ ] **Step 1: Update `AddSourceDialog.tsx`**

Add `Phone` to the lucide-react import:

```ts
import { Plus, FileText, Globe, AlignLeft, MessageSquare, Phone, ChevronDown } from 'lucide-react'
```

Add the import for the new form:

```ts
import CallTranscriptForm from './CallTranscriptForm'
```

Update the **local UI** `SourceType` type (defined at the top of this file, line 24 — not the one from `@/types`) to include `'call_transcript'`. This type only controls which dialog panel to show; it is unrelated to the data model type in `src/types/index.ts`.

```ts
type SourceType = 'file' | 'website' | 'text' | 'questionnaire' | 'call_transcript'
```

Add the entry to `SOURCE_TYPES` array (insert before `'text'`):

```ts
{ value: 'call_transcript', label: 'Call Transcript', description: 'Upload file or paste text', icon: Phone },
```

Add to `DIALOG_TITLES`:

```ts
call_transcript: 'Call transcript',
```

Add the form render inside the Dialog content block:

```tsx
{activeType === 'call_transcript' && <CallTranscriptForm projectId={projectId} onAdded={handleAdded} />}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/sources/AddSourceDialog.tsx
git commit -m "feat: add Call Transcript entry to Add Source dialog"
```

---

### Task 8: Update FileUploadForm — add spreadsheet, remove stale call_transcript entry

**Files:**
- Modify: `src/components/sources/FileUploadForm.tsx`

`FileUploadForm` currently has a `call_transcript` entry in `FILE_TYPES` (`.txt,.pdf`). Now that the dedicated `CallTranscriptForm` handles all call transcript uploads (with `.docx` support), this entry is redundant and creates confusing duplicate paths. Remove it and add `spreadsheet` in its place.

- [ ] **Step 1: In `src/components/sources/FileUploadForm.tsx`, remove the `call_transcript` entry from `FILE_TYPES`**

Remove this line:
```ts
{ value: 'call_transcript', label: 'Call transcript (.txt, .pdf)', accept: '.txt,.pdf' },
```

- [ ] **Step 2: Add spreadsheet to `FILE_TYPES`**

The array currently ends with `job_description_detailed`. Append:

```ts
{ value: 'spreadsheet', label: 'Spreadsheet (.csv, .xlsx)', accept: '.csv,.xlsx,.xls' },
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors (the `'spreadsheet'` type was added to the union in Task 4)

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/sources/FileUploadForm.tsx
git commit -m "feat: add spreadsheet to file upload form; remove redundant call_transcript entry"
```

---

### Task 9: Smoke test & final verification

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript or compilation errors

- [ ] **Step 2: Manual test checklist (dev server)**

```bash
npm run dev
```

Verify each flow:

1. **Call Transcript — file upload:** Add source → Call Transcript → Upload file → upload a `.txt` or `.pdf` file → confirm it appears in sources list
2. **Call Transcript — paste:** Add source → Call Transcript → Paste text → paste some text → confirm source appears
3. **Call Transcript — .docx:** Add source → Call Transcript → Upload file → upload a `.docx` file → confirm extracted text appears (check via sources panel)
4. **Spreadsheet:** Add source → File → Spreadsheet → upload a `.csv` or `.xlsx` file → confirm sheet tables appear in extracted content
5. **Existing .docx job description still works:** Add source → File → "Detailed job description" → upload a `.docx` file → confirm text is extracted correctly (verifies the new `.docx` branch in the API doesn't break the existing job description flow)

- [ ] **Step 3: Final commit if any tweaks were needed**

```bash
git add -p
git commit -m "fix: polish transcript and spreadsheet upload flows"
```
