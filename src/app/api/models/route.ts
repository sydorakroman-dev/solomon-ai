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
