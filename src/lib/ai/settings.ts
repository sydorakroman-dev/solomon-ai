import { createAdminClient } from '@/lib/supabase/server'

interface AISettings {
  model: string
  anthropic_api_key: string | null
  openai_api_key: string | null
  gemini_api_key: string | null
}

/**
 * Get effective AI settings for a user.
 * Falls back to the admin user's settings if the user has no API keys configured.
 */
export async function getEffectiveAISettings(userId: string): Promise<AISettings> {
  const adminClient = await createAdminClient()

  const { data: userSettings } = await adminClient
    .from('user_settings').select('*').eq('user_id', userId).single()

  // If user has at least one API key, use their settings
  if (userSettings?.anthropic_api_key || userSettings?.openai_api_key || userSettings?.gemini_api_key) {
    return {
      model: userSettings.model ?? 'anthropic:claude-sonnet-4-6',
      anthropic_api_key: userSettings.anthropic_api_key ?? null,
      openai_api_key: userSettings.openai_api_key ?? null,
      gemini_api_key: userSettings.gemini_api_key ?? null,
    }
  }

  // Fall back to admin user's settings
  const { data: adminProfile } = await adminClient
    .from('profiles').select('user_id').eq('role', 'admin').limit(1).single()

  if (adminProfile?.user_id) {
    const { data: adminSettings } = await adminClient
      .from('user_settings').select('*').eq('user_id', adminProfile.user_id).single()

    if (adminSettings) {
      return {
        model: userSettings?.model ?? adminSettings.model ?? 'anthropic:claude-sonnet-4-6',
        anthropic_api_key: adminSettings.anthropic_api_key ?? null,
        openai_api_key: adminSettings.openai_api_key ?? null,
        gemini_api_key: adminSettings.gemini_api_key ?? null,
      }
    }
  }

  return {
    model: userSettings?.model ?? 'anthropic:claude-sonnet-4-6',
    anthropic_api_key: null,
    openai_api_key: null,
    gemini_api_key: null,
  }
}
