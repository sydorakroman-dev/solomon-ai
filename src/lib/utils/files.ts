// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse')

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer)
  return (data.text as string).trim()
}

import * as mammoth from 'mammoth'

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
