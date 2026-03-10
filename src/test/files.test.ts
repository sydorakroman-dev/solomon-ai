// @vitest-environment node
// pdf-parse initialises a CJS bundle that references browser APIs (DOMMatrix, Path2D)
// which jsdom does not fully implement. Running this file in the Node environment avoids
// the crash while still letting us mock the actual PDF parsing.

import { describe, it, expect, vi } from 'vitest'

vi.mock('pdf-parse', () => {
  const fn = vi.fn().mockResolvedValue({ text: 'Extracted PDF text content.', numpages: 2 })
  return { default: fn, ...fn }
})

vi.mock('mammoth', () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: '  Call transcript text.  ' }),
}))

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

import { extractJsonSchema, truncateContent, extractDocxText, extractSpreadsheet } from '@/lib/utils/files'
import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'

describe('extractJsonSchema', () => {
  it('pretty-prints valid JSON', () => {
    const input = '{"name":"Solomon","version":1}'
    const result = extractJsonSchema(input)
    expect(result).toBe(JSON.stringify({ name: 'Solomon', version: 1 }, null, 2))
  })

  it('handles nested JSON objects', () => {
    const input = '{"tables":{"users":{"columns":["id","name"]}}}'
    const parsed = JSON.parse(extractJsonSchema(input))
    expect(parsed.tables.users.columns).toEqual(['id', 'name'])
  })

  it('handles JSON arrays', () => {
    const input = '[{"field":"id","type":"uuid"},{"field":"name","type":"text"}]'
    const result = extractJsonSchema(input)
    const parsed = JSON.parse(result)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].field).toBe('id')
  })

  it('returns original text when JSON is invalid', () => {
    const invalid = 'not valid json {{'
    expect(extractJsonSchema(invalid)).toBe(invalid)
  })

  it('returns original text for empty string', () => {
    expect(extractJsonSchema('')).toBe('')
  })

  it('handles JSON with unicode characters', () => {
    const input = '{"description":"Café & Bar → Müller"}'
    const result = JSON.parse(extractJsonSchema(input))
    expect(result.description).toBe('Café & Bar → Müller')
  })
})

describe('truncateContent', () => {
  it('returns content unchanged when under the limit', () => {
    const content = 'Hello world'
    expect(truncateContent(content)).toBe(content)
  })

  it('returns content unchanged when exactly at the limit', () => {
    const content = 'x'.repeat(50000)
    expect(truncateContent(content)).toBe(content)
  })

  it('truncates content that exceeds the default 50000 char limit', () => {
    const content = 'x'.repeat(60000)
    const result = truncateContent(content)
    expect(result.length).toBeLessThan(60000)
    expect(result.endsWith('[Content truncated...]')).toBe(true)
  })

  it('preserves the first maxChars characters exactly', () => {
    const content = 'ABCDE'.repeat(12000) // 60000 chars
    const result = truncateContent(content)
    expect(result.startsWith('ABCDE'.repeat(10000))).toBe(true)
  })

  it('respects a custom maxChars limit', () => {
    const content = 'Hello world and more'
    const result = truncateContent(content, 5)
    expect(result).toBe('Hello\n\n[Content truncated...]')
  })

  it('handles empty string', () => {
    expect(truncateContent('')).toBe('')
  })

  it('handles exactly one char over the limit', () => {
    const content = 'x'.repeat(50001)
    const result = truncateContent(content)
    expect(result.endsWith('[Content truncated...]')).toBe(true)
  })
})

// extractPdfText is a thin wrapper: `const data = await pdfParse(buffer); return data.text.trim()`
// Testing its integration requires a real PDF fixture and a Node-compatible build of pdf-parse.
// The meaningful testable surface (extractJsonSchema, truncateContent) is fully covered above.

describe('extractDocxText', () => {
  it('extracts and trims text from a DOCX buffer', async () => {
    const result = await extractDocxText(Buffer.from('fake-docx'))
    expect(result).toBe('Call transcript text.')
  })

  it('returns empty string when DOCX has no text', async () => {
    vi.mocked(mammoth.extractRawText).mockResolvedValueOnce({ value: '   ', messages: [] })
    const result = await extractDocxText(Buffer.from('empty-docx'))
    expect(result).toBe('')
  })
})

describe('extractSpreadsheet', () => {
  it('formats a single sheet as a markdown table', () => {
    const result = extractSpreadsheet(Buffer.from('fake-xlsx'))
    expect(result).toContain('# Sheet: Sales Data')
    expect(result).toContain('| Month | Revenue | Deals |')
    expect(result).toContain('| Jan | 42000 | 12 |')
    expect(result).toContain('| Feb | 38000 | 9 |')
  })

  it('includes separator row in markdown table', () => {
    const result = extractSpreadsheet(Buffer.from('fake-xlsx'))
    expect(result).toContain('| --- |')
  })

  it('throws when all sheets are empty', () => {
    vi.mocked(XLSX.utils.sheet_to_json).mockReturnValueOnce([])
    expect(() => extractSpreadsheet(Buffer.from('empty'))).toThrow('Spreadsheet appears to be empty')
  })

  it('handles multiple sheets', () => {
    vi.mocked(XLSX.read).mockReturnValueOnce({
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: { Sheet1: {}, Sheet2: {} },
    } as unknown as XLSX.WorkBook)
    vi.mocked(XLSX.utils.sheet_to_json)
      .mockReturnValueOnce([{ A: '1' }])
      .mockReturnValueOnce([{ B: '2' }])
    const result = extractSpreadsheet(Buffer.from('multi'))
    expect(result).toContain('# Sheet: Sheet1')
    expect(result).toContain('# Sheet: Sheet2')
  })

  it('notes truncated sheets when content exceeds 50000 chars', () => {
    vi.mocked(XLSX.read).mockReturnValueOnce({
      SheetNames: ['Big', 'Small'],
      Sheets: { Big: {}, Small: {} },
    } as unknown as XLSX.WorkBook)
    const bigRows = Array.from({ length: 1000 }, () => ({
      Col1: 'x'.repeat(50),
      Col2: 'y'.repeat(50),
    }))
    vi.mocked(XLSX.utils.sheet_to_json)
      .mockReturnValueOnce(bigRows)
      .mockReturnValueOnce([{ Z: 'skipped' }])
    const result = extractSpreadsheet(Buffer.from('big'))
    expect(result).toContain('additional sheet')
    expect(result).toContain('truncated')
  })
})
