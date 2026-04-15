import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateText } from '@/lib/ai/providers'
import { truncateContent } from '@/lib/utils/files'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { project_id, clarification } = await request.json()
  if (!project_id) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  // Get project
  const { data: project } = await supabase
    .from('projects')
    .select('name, client_name, industry, type, mode')
    .eq('id', project_id)
    .eq('user_id', user.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Get user settings via admin client to bypass RLS
  const adminClient = await createAdminClient()
  const { data: settings } = await adminClient
    .from('user_settings')
    .select('anthropic_api_key, openai_api_key, gemini_api_key, model')
    .eq('user_id', user.id)
    .single()

  // Resolve prompt: project override → system default
  const { data: projectPrompt } = await supabase
    .from('project_prompts')
    .select('content')
    .eq('project_id', project_id)
    .eq('stage', 'charter')
    .single()

  const { data: systemPrompt } = await supabase
    .from('system_prompts')
    .select('content')
    .eq('stage', 'charter')
    .single()

  const systemInstruction = projectPrompt?.content ?? systemPrompt?.content ?? ''

  // Get all sources
  const { data: sources } = await supabase
    .from('data_sources')
    .select('type, title, content')
    .eq('project_id', project_id)
    .eq('status', 'ready')
    .eq('enabled', true)
    .not('content', 'is', null)

  const sourceContext = (sources ?? [])
    .map(s => `### [${s.type.toUpperCase()}] ${s.title}\n${s.content}`)
    .join('\n\n---\n\n')

  // If clarifying, fetch the current charter to refine it
  let currentContent: string | null = null
  if (clarification) {
    const { data: current } = await supabase
      .from('project_charter')
      .select('content')
      .eq('project_id', project_id)
      .order('version', { ascending: false })
      .limit(1)
      .single()
    currentContent = current?.content ?? null
  }

  const userMessage = clarification && currentContent ? `
Project Details:
- Name: ${project.name}
- Client: ${project.client_name ?? 'Not specified'}
- Industry: ${project.industry ?? 'Not specified'}
- Type: ${project.type}

SOURCE DOCUMENTS:
${sourceContext ? truncateContent(sourceContext, 60000) : 'No source documents provided.'}

---

CURRENT PROJECT CHARTER:
${currentContent}

---

CLARIFICATION REQUEST:
${clarification}

Please refine the Project Charter above based on the clarification request. Keep all sections that don't need to change. Update only the parts relevant to the request. Return the complete updated charter in the same markdown format.
`.trim() : `
Project Details:
- Name: ${project.name}
- Client: ${project.client_name ?? 'Not specified'}
- Industry: ${project.industry ?? 'Not specified'}
- Type: ${project.type} (${project.type === 'greenfield' ? 'new build' : 'existing system enhancement'})

SOURCE DOCUMENTS:
${sourceContext ? truncateContent(sourceContext, 80000) : 'No source documents provided yet.'}

---

Generate a comprehensive Project Charter for this project. Structure it with these sections:

# Project Charter: [Project Name]

## Executive Summary
Brief overview of the project.

## Project Sponsor & Stakeholders
- **Sponsor:** [Who is funding/authorising]
- **Product Owner:** [Name, contact]
- **Project Manager:** [Name, contact]
- **Key Stakeholders:** [List with roles and interests]

## Business Case
Why this project is being undertaken. The business problem or opportunity.

## Project Goals & Objectives
Clear, measurable goals. What success looks like.

## Scope
**In Scope:**
- [list]

**Out of Scope:**
- [list]

## Key Deliverables
What will be produced.

## High-Level Timeline
Major milestones and approximate dates.

## Budget & Resources
Budget range and team composition.

## Major Risks
Top risks and initial mitigation ideas.

## Success Criteria
How we will measure project success (KPIs, metrics).

## QC Goals
Quality/learning objectives (profit targets, technology adoption, team development).

## Assumptions & Constraints
Key assumptions and constraints.

---

Where information is missing or unclear, note it clearly with [TBD] or [TO BE CONFIRMED] so the PM knows what to fill in.
Use a professional, formal tone appropriate for a project initiation document.
`.trim()

  try {
    const content = await generateText({
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

    // Get current version count
    const { data: existing } = await supabase
      .from('project_charter')
      .select('id, version')
      .eq('project_id', project_id)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    const version = existing ? existing.version + 1 : 1

    const { data: charter, error } = await supabase
      .from('project_charter')
      .insert({ project_id, content, version, status: 'draft' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Advance project status
    await supabase
      .from('projects')
      .update({ status: 'charter' })
      .eq('id', project_id)
      .eq('user_id', user.id)
      .in('status', ['setup', 'sources'])

    return NextResponse.json(charter, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI generation failed' }, { status: 400 })
  }
}
