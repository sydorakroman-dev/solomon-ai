import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateText } from '@/lib/ai/providers'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { project_id, epic_id } = await request.json()

  const { data: project } = await supabase
    .from('projects').select('name, mode').eq('id', project_id).eq('user_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const adminClient = await createAdminClient()
  const { data: settings } = await adminClient
    .from('user_settings').select('anthropic_api_key, openai_api_key, gemini_api_key, model').eq('user_id', user.id).single()

  const [{ data: projectPrompt }, { data: systemPrompt }, { data: prd }] = await Promise.all([
    supabase.from('project_prompts').select('content').eq('project_id', project_id).eq('stage', 'stories').single(),
    supabase.from('system_prompts').select('content').eq('stage', 'stories').single(),
    supabase.from('prd').select('content').eq('project_id', project_id).order('version', { ascending: false }).limit(1).single(),
  ])

  // Get epic context if generating for a specific epic
  let epicContext = ''
  let epicTitle = ''
  if (epic_id) {
    const { data: epic } = await supabase.from('epics').select('*').eq('id', epic_id).single()
    if (epic) {
      epicTitle = epic.title
      epicContext = `\nEPIC CONTEXT:\nCode: ${epic.code}\nTitle: ${epic.title}\nDescription: ${epic.description}\nAcceptance Criteria: ${epic.acceptance_criteria}`
    }
  }

  const systemInstruction = projectPrompt?.content ?? systemPrompt?.content ?? ''

  const userMessage = `
Project: ${project.name}
${epicContext}

PRD:
${prd?.content ?? 'Not available.'}

---

Generate User Stories${epicTitle ? ` for the epic "${epicTitle}"` : ' for this project'}.
Output a JSON array only — no markdown, no explanation.

Each story:
{
  "title": "string (short summary)",
  "as_a": "string (role/persona)",
  "i_want": "string (the feature or capability)",
  "so_that": "string (the benefit or outcome)",
  "acceptance_criteria": ["string", "string", ...],
  "priority": "must" | "should" | "could" | "wont",
  "effort_estimate": "S" | "M" | "L" | "XL"
}

Generate 4-8 stories. Each must be independently testable. Acceptance criteria should be specific and verifiable.
Output only the JSON array.
`.trim()

  try {
    const text = await generateText({
      model: settings?.model ?? 'anthropic:claude-sonnet-4-6',
      systemPrompt: systemInstruction,
      userPrompt: userMessage,
      maxTokens: 4000,
      apiKeys: {
        anthropic: settings?.anthropic_api_key,
        openai: settings?.openai_api_key,
        gemini: settings?.gemini_api_key,
      },
    })
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })

    const storiesData = JSON.parse(jsonMatch[0]) as Array<{
      title: string; as_a: string; i_want: string; so_that: string;
      acceptance_criteria: string[]; priority: string; effort_estimate: string
    }>

    const { count: existing } = await supabase
      .from('user_stories').select('*', { count: 'exact', head: true }).eq('project_id', project_id)

    const storiesToInsert = storiesData.map((s, i) => ({
      project_id,
      epic_id: epic_id ?? null,
      code: `US-${String((existing ?? 0) + i + 1).padStart(3, '0')}`,
      title: s.title,
      as_a: s.as_a ?? '',
      i_want: s.i_want ?? '',
      so_that: s.so_that ?? '',
      acceptance_criteria: Array.isArray(s.acceptance_criteria) ? s.acceptance_criteria : [],
      priority: s.priority ?? 'should',
      effort_estimate: s.effort_estimate ?? null,
      order: (existing ?? 0) + i,
      status: 'draft',
      version: 1,
    }))

    const { data: inserted, error } = await supabase
      .from('user_stories').insert(storiesToInsert).select()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await supabase.from('projects').update({ status: 'stories' })
      .eq('id', project_id).eq('user_id', user.id).in('status', ['prd', 'epics'])

    return NextResponse.json(inserted, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI generation failed' }, { status: 400 })
  }
}
