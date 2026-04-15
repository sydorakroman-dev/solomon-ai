import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText } from '@/lib/ai/providers'
import { getEffectiveAISettings } from '@/lib/ai/settings'

async function jinaSearch(query: string): Promise<string> {
  const url = `https://s.jina.ai/${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  return res.text()
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { project_id, industry: industryOverride, company: companyOverride, focus } = body
  if (!project_id) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const { data: project } = await supabase
    .from('projects')
    .select('name, client_name, industry')
    .eq('id', project_id)
    .eq('user_id', user.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const settings = await getEffectiveAISettings(user.id)

  const industry = industryOverride?.trim() || project.industry
  const company  = companyOverride?.trim()  || project.client_name
  const subject  = industry ?? project.name

  const context = [
    industry && `Industry: ${industry}`,
    company  && `Company: ${company}`,
    `Project: ${project.name}`,
    focus?.trim() && `Research focus: ${focus.trim()}`,
  ].filter(Boolean).join(', ')

  try {
    const searchQueries = [
      `${subject} industry overview market trends 2025`,
      `${subject} software solutions key players competitors`,
      `${subject} digital transformation challenges regulations`,
      ...(focus?.trim() ? [`${subject} ${focus.trim()}`] : []),
    ]

    const searchResults = await Promise.all(
      searchQueries.map(q => jinaSearch(q).catch(() => ''))
    )

    const searchContext = searchResults
      .filter(Boolean)
      .map((text, i) => `### Search: ${searchQueries[i]}\n${text.slice(0, 3000)}`)
      .join('\n\n---\n\n')

    const userPrompt = `You are a domain research specialist preparing context for a software project requirements session.

Project context: ${context}

Based on the following web research, create a structured domain knowledge summary that will help a Business Analyst understand the industry landscape before gathering requirements.

RESEARCH DATA:
${searchContext}

Write a clear, structured summary covering:
1. **Industry Overview** — what this industry does, key characteristics
2. **Market Landscape** — major players, market size/trends
3. **Common Challenges** — top problems companies in this space face
4. **Technology Trends** — relevant tech being adopted
5. **Regulatory & Compliance Considerations** — relevant regulations or standards
6. **Key Terminology** — domain-specific terms a BA should know

Keep it factual and relevant to software development requirements gathering. Format with markdown headings.`

    const content = await generateText({
      model: settings.model,
      systemPrompt: '',
      userPrompt,
      maxTokens: 2000,
      apiKeys: {
        anthropic: settings.anthropic_api_key,
        openai: settings.openai_api_key,
        gemini: settings.gemini_api_key,
      },
    })

    const { data: source, error } = await supabase
      .from('data_sources')
      .insert({
        project_id,
        user_id: user.id,
        type: 'domain_knowledge',
        title: `Domain Research: ${industry ?? project.name}`,
        content,
        metadata: {
          generated_at: new Date().toISOString(),
          queries: searchQueries,
        },
        status: 'ready',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(source, { status: 201 })

  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI generation failed' }, { status: 400 })
  }
}
