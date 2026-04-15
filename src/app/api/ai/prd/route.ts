import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText } from '@/lib/ai/providers'
import { truncateContent } from '@/lib/utils/files'
import { getEffectiveAISettings } from '@/lib/ai/settings'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { project_id, clarification } = await request.json()
  if (!project_id) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const { data: project } = await supabase
    .from('projects')
    .select('name, client_name, industry, type, mode')
    .eq('id', project_id).eq('user_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const settings = await getEffectiveAISettings(user.id)

  const [{ data: projectPrompt }, { data: systemPrompt }, { data: charter }, { data: sources }] =
    await Promise.all([
      supabase.from('project_prompts').select('content').eq('project_id', project_id).eq('stage', 'prd').single(),
      supabase.from('system_prompts').select('content').eq('stage', 'prd').single(),
      supabase.from('project_charter').select('content').eq('project_id', project_id).order('version', { ascending: false }).limit(1).single(),
      supabase.from('data_sources').select('type, title, content').eq('project_id', project_id).eq('status', 'ready').eq('enabled', true).not('content', 'is', null),
    ])

  const systemInstruction = projectPrompt?.content ?? systemPrompt?.content ?? ''
  const sourceContext = (sources ?? [])
    .map(s => `### [${s.type.toUpperCase()}] ${s.title}\n${s.content}`)
    .join('\n\n---\n\n')

  // If clarifying, fetch the current PRD to refine
  let currentPrdContent: string | null = null
  if (clarification) {
    const { data: current } = await supabase
      .from('prd')
      .select('content')
      .eq('project_id', project_id)
      .order('version', { ascending: false })
      .limit(1)
      .single()
    currentPrdContent = current?.content ?? null
  }

  const userMessage = clarification && currentPrdContent ? `
Project: ${project.name} | Client: ${project.client_name ?? 'N/A'} | Industry: ${project.industry ?? 'N/A'}
Type: ${project.type} | Mode: ${project.mode}

PROJECT CHARTER:
${charter?.content ?? 'Not yet created.'}

SOURCE DOCUMENTS:
${sourceContext ? truncateContent(sourceContext, 50000) : 'None provided.'}

---

CURRENT PRD:
${currentPrdContent}

---

CLARIFICATION REQUEST:
${clarification}

Please refine the PRD above based on the clarification request. Keep all sections that don't need to change. Update only the parts relevant to the request. Return the complete updated PRD in the same markdown format.
`.trim() : `
Project: ${project.name} | Client: ${project.client_name ?? 'N/A'} | Industry: ${project.industry ?? 'N/A'}
Type: ${project.type} | Mode: ${project.mode}

PROJECT CHARTER:
${charter?.content ?? 'Not yet created.'}

SOURCE DOCUMENTS:
${sourceContext ? truncateContent(sourceContext, 70000) : 'None provided.'}

---

Generate a comprehensive Product Requirements Document (PRD) covering:

# PRD: [Project Name]

## Business Case
Why this product is being built. Business problem and opportunity.

## Business Context & Goals
- **Goals/Objectives:** What problem are we solving?
- **The "Why":** Strategic rationale
- **KPIs:** How we measure success
- **Definition of Success:** Concrete success criteria

## Current State Analysis
- **Manual processes:** How things work today
- **Software currently used:** Existing tools
- **Top 3 pain points:** Key frustrations

## Users & Stakeholders
- **Primary users:** User personas — who they are, what they need
- **Decision maker:** Who approves/signs off

## Desired Future State
- **Ideal process:** How things should work after the product is built
- **Key data needs:** What information the system must capture and provide

## Hypothesis
- **Pain points addressed**
- **Goals achieved**
- **Potential solutions considered**

## Functional Requirements
High-level user stories and functional needs.

## Non-Functional Requirements
Performance, security, scalability, accessibility, and other quality attributes.

## Technical Environment & Constraints
Platform, integrations, tech stack preferences, compliance requirements.

## Success Metrics
How we measure whether the product achieves its goals.

---

Mark unknowns as [TBD]. Be specific and actionable. Requirements must be SMART.
`.trim()

  try {
    const content = await generateText({
      model: settings.model,
      systemPrompt: systemInstruction,
      userPrompt: userMessage,
      maxTokens: 6000,
      apiKeys: {
        anthropic: settings.anthropic_api_key,
        openai: settings.openai_api_key,
        gemini: settings.gemini_api_key,
      },
    })

    const { data: existing } = await supabase
      .from('prd').select('version').eq('project_id', project_id)
      .order('version', { ascending: false }).limit(1).single()

    const version = existing ? existing.version + 1 : 1

    const { data: prd, error } = await supabase
      .from('prd')
      .insert({ project_id, content, version, status: 'draft' })
      .select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await supabase.from('projects').update({ status: 'prd' })
      .eq('id', project_id).eq('user_id', user.id).eq('status', 'charter')

    return NextResponse.json(prd, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI generation failed' }, { status: 400 })
  }
}
