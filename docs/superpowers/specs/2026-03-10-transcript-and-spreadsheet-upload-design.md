# Design: Call Transcript Upload & Spreadsheet Analysis

**Date:** 2026-03-10
**Status:** Approved

---

## Overview

Two new source ingestion capabilities:

1. **Call Transcript** — a dedicated source type with a unified form that accepts either a file upload (`.txt`, `.pdf`, `.docx`) or pasted text.
2. **Spreadsheet** — a new file source type accepting `.csv`, `.xlsx`, `.xls` with thorough multi-sheet extraction formatted for AI analysis.

---

## Feature 1: Call Transcript

### UX Flow

A new "Call Transcript" entry is added to the `AddSourceDialog` dropdown (alongside File, Website, Text, Interview). Clicking it opens `CallTranscriptForm`, which has two tabs:

- **Upload file** — drag/click to upload `.txt`, `.pdf`, or `.docx`
- **Paste text** — textarea for direct paste

Both share a common optional title field and submit to the existing `/api/sources` endpoint using the `call_transcript` source type.

### Components

| File | Change |
|------|--------|
| `src/components/sources/CallTranscriptForm.tsx` | New component with Upload/Paste tabs |
| `src/components/sources/AddSourceDialog.tsx` | Add `call_transcript` entry to SOURCE_TYPES |
| `src/lib/utils/files.ts` | Add `extractDocxText()` using `mammoth` |
| `src/app/api/sources/route.ts` | Add `.docx` branch in `handleFileUpload()` |

### File Parsing

| Extension | Parser |
|-----------|--------|
| `.pdf` | `extractPdfText()` (existing) |
| `.txt` | UTF-8 decode (existing) |
| `.docx` | `mammoth.extractRawText()` (new) |

The pasted-text path sends a JSON body (same as the existing "Text" source flow) with `type: 'call_transcript'`.

---

## Feature 2: Spreadsheets

### UX Flow

A new "Spreadsheet" entry is added to the file type selector inside `FileUploadForm`. Accepted formats: `.csv`, `.xlsx`, `.xls`. No separate dialog entry needed — it fits naturally in the existing File upload flow.

### Components

| File | Change |
|------|--------|
| `src/components/sources/FileUploadForm.tsx` | Add `spreadsheet` to FILE_TYPES |
| `src/lib/utils/files.ts` | Add `extractSpreadsheet()` using SheetJS |
| `src/app/api/sources/route.ts` | Add spreadsheet branch in `handleFileUpload()` |
| `src/types/index.ts` | Add `'spreadsheet'` to `SourceType` union |

### Extraction Strategy

SheetJS (`xlsx` package) reads all sheets. Each sheet is converted to a markdown table:

```
# Sheet: Sales Data
| Month | Revenue | Deals |
|-------|---------|-------|
| Jan   | 42000   | 12    |
| Feb   | 38000   | 9     |

# Sheet: Pipeline
| Account | Stage  | Value |
|---------|--------|-------|
...
```

**Large file handling:** Sheets are processed in document order. Once the accumulated content exceeds 50,000 characters, remaining sheets are skipped and a note is appended: `[N additional sheets truncated — upload separately for full coverage]`. The first sheet always fits regardless of size.

**Empty row/column handling:** Trailing empty rows and fully-empty columns are stripped before conversion.

---

## Dependencies to Install

```
mammoth       # .docx text extraction (call transcripts)
xlsx          # CSV/XLSX/XLS spreadsheet parsing
```

---

## Data Model

No database schema changes required. The existing `data_sources` table handles both new types via:
- `type`: `'call_transcript'` (existing) or `'spreadsheet'` (new TS union value only)
- `content`: extracted text
- `metadata`: `{ file_name, file_size, file_type, sheet_count? }`
- `embedding`: generated as usual via Voyage AI

---

## Error Handling

- Corrupt/unreadable files return HTTP 422 with a descriptive message
- Empty spreadsheets (no data rows) return an error: "Spreadsheet appears to be empty"
- `.docx` files with no extractable text fall back to an error prompt to the user
- Storage upload failures are non-blocking (existing behavior retained)
