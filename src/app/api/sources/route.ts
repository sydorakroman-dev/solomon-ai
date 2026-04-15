import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractPdfText, extractDocxText, extractJsonSchema, extractSpreadsheet, truncateContent } from '@/lib/utils/files'
import { scrapeWebsite } from '@/lib/utils/scraper'
import { generateEmbedding } from '@/lib/utils/embeddings'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('data_sources')
    .select('id, project_id, type, title, status, enabled, metadata, created_at, has_embedding')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  try {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('content-type') ?? ''

  // File upload (PDF, JSON)
  if (contentType.includes('multipart/form-data')) {
    return handleFileUpload(request, supabase, user.id)
  }

  // JSON body (text, website, questionnaire)
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { project_id, type, title, content, url, answers } = body as {
    project_id?: string; type?: string; title?: string
    content?: string; url?: string; answers?: Record<string, string>
  }

  if (!project_id || !type) {
    return NextResponse.json({ error: 'project_id and type required' }, { status: 400 })
  }

  let extractedContent = ''
  let metadata: Record<string, unknown> = {}

  try {
    if (type === 'website' && url) {
      const scraped = await scrapeWebsite(url)
      extractedContent = truncateContent(scraped.content)
      metadata = { url, scraped_title: scraped.title }
    } else if (type === 'questionnaire' && answers) {
      extractedContent = formatQuestionnaireAnswers(answers)
      metadata = { answer_count: Object.keys(answers).length }
    } else if (content) {
      extractedContent = truncateContent(content)
    } else {
      return NextResponse.json({ error: 'Content or URL required' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Processing failed' },
      { status: 422 }
    )
  }

  const { data, error } = await supabase
    .from('data_sources')
    .insert({
      project_id,
      user_id: user.id,
      type,
      title: title?.trim() || (type === 'website' ? url : type),
      content: extractedContent,
      metadata,
      status: 'ready',
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/sources] insert error', error)
    return NextResponse.json({ error: error.message || error.code || JSON.stringify(error) }, { status: 500 })
  }

  // Advance project status to 'sources' if still at 'setup'
  await supabase
    .from('projects')
    .update({ status: 'sources' })
    .eq('id', project_id)
    .eq('user_id', user.id)
    .eq('status', 'setup')

  // Generate and store embedding (fire-and-forget — source is saved regardless)
  embedSource(supabase, data.id, extractedContent, user.id)

  return NextResponse.json(data, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    const extra = typeof err === 'object' && err !== null ? JSON.stringify(err) : undefined
    console.error('[POST /api/sources]', { message, stack, extra })
    return NextResponse.json(
      { error: message || extra || 'Unknown error', detail: stack?.split('\n')[1]?.trim() },
      { status: 500 }
    )
  }
}

async function handleFileUpload(
  request: Request,
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  userId: string
) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const projectId = formData.get('project_id') as string
  const type = formData.get('type') as string
  const title = formData.get('title') as string

  if (!file || !projectId || !type) {
    return NextResponse.json({ error: 'file, project_id, and type required' }, { status: 400 })
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  let content = ''
  const metadata: Record<string, unknown> = { file_name: file.name, file_size: file.size }

  try {
    if (file.name.endsWith('.pdf')) {
      content = truncateContent(await extractPdfText(buffer))
      metadata.file_type = 'pdf'
    } else if (file.name.endsWith('.docx')) {
      content = truncateContent(await extractDocxText(buffer))
      metadata.file_type = 'docx'
    } else if (file.name.endsWith('.json')) {
      content = extractJsonSchema(buffer.toString('utf-8'))
      metadata.file_type = 'json'
    } else if (
      file.name.endsWith('.csv') ||
      file.name.endsWith('.xlsx') ||
      file.name.endsWith('.xls')
    ) {
      content = extractSpreadsheet(buffer)
      metadata.file_type = file.name.endsWith('.csv') ? 'csv' : 'xlsx'
      metadata.sheet_count = (content.match(/^# Sheet:/gm) ?? []).length
    } else {
      // Plain text / transcript
      content = truncateContent(buffer.toString('utf-8'))
      metadata.file_type = 'text'
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'File processing failed' },
      { status: 422 }
    )
  }

  // Upload original file to Supabase Storage
  const filePath = `${userId}/${projectId}/${Date.now()}_${file.name}`
  const { error: uploadError } = await supabase.storage
    .from('sources')
    .upload(filePath, buffer, { contentType: file.type })

  if (uploadError) {
    console.warn('Storage upload failed:', uploadError.message)
    // Continue without storage — content is still saved
  }

  const { data, error } = await supabase
    .from('data_sources')
    .insert({
      project_id: projectId,
      user_id: userId,
      type,
      title: title?.trim() || file.name,
      content,
      file_path: uploadError ? null : filePath,
      metadata,
      status: 'ready',
    })
    .select()
    .single()

  if (error) {
    console.error('[handleFileUpload] insert error', error)
    return NextResponse.json({ error: error.message || error.code || JSON.stringify(error) }, { status: 500 })
  }

  await supabase
    .from('projects')
    .update({ status: 'sources' })
    .eq('id', projectId)
    .eq('user_id', userId)
    .eq('status', 'setup')

  // Generate and store embedding (fire-and-forget)
  embedSource(supabase, data.id, content, userId)

  return NextResponse.json(data, { status: 201 })
}

// Generates embedding and writes it back to the source row.
// Called after the source is saved — never blocks the response.
async function embedSource(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  sourceId: string,
  content: string,
  userId: string
) {
  try {
    const { data: settings } = await supabase
      .from('user_settings')
      .select('voyage_api_key')
      .eq('user_id', userId)
      .single()

    if (!settings?.voyage_api_key) return // no key configured — skip silently

    const embedding = await generateEmbedding(content, settings.voyage_api_key)
    await supabase
      .from('data_sources')
      .update({ embedding: JSON.stringify(embedding) })
      .eq('id', sourceId)
  } catch (err) {
    console.warn('Embedding generation failed:', err instanceof Error ? err.message : err)
  }
}

function formatQuestionnaireAnswers(answers: Record<string, string>): string {
  const questions: Record<string, string> = {
    business_problem: 'What business problem or opportunity does this project address?',
    target_users: 'Who are the primary users of this system?',
    current_process: 'How is this currently being handled (manual process or existing tools)?',
    pain_points: 'What are the top 3 pain points with the current approach?',
    desired_outcome: 'What does success look like? What should the system do?',
    key_features: 'What are the most critical features or capabilities needed?',
    technical_constraints: 'Are there any technical constraints or requirements (platform, integrations, security)?',
    timeline: 'What is the expected timeline or deadline?',
    budget: 'Is there a budget range or resource constraint?',
    stakeholders: 'Who are the key stakeholders and decision makers?',
  }

  return Object.entries(answers)
    .filter(([, value]) => value?.trim())
    .map(([key, value]) => `**${questions[key] ?? key}**\n${value}`)
    .join('\n\n')
}
