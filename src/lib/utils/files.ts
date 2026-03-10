import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse')

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer)
  return (data.text as string).trim()
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return (result.value as string).trim()
}

export function extractJsonSchema(text: string): string {
  try {
    const parsed = JSON.parse(text)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return text
  }
}

export function truncateContent(content: string, maxChars = 50000): string {
  if (content.length <= maxChars) return content
  return content.slice(0, maxChars) + '\n\n[Content truncated...]'
}

export function extractSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' })

  const MAX_CHARS = 50000
  const sections: string[] = []
  let totalChars = 0
  let skipped = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

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
