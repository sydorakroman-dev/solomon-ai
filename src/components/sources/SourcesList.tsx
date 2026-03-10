'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2, FileText, Globe, Database, MessageSquare, Briefcase, Brain, ClipboardList, Eye, Sparkles, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatDistanceToNow } from 'date-fns'
import MarkdownViewer from '@/components/charter/MarkdownViewer'
import type { DataSource, SourceType } from '@/types'

const SOURCE_CONFIG: Record<SourceType, { label: string; icon: React.ElementType; color: string }> = {
  text:                    { label: 'Text',            icon: FileText,      color: 'bg-zinc-100 text-zinc-600' },
  pdf:                     { label: 'PDF',             icon: FileText,      color: 'bg-red-50 text-red-600' },
  json_schema:             { label: 'DB Schema',       icon: Database,      color: 'bg-blue-50 text-blue-600' },
  website:                 { label: 'Website',         icon: Globe,         color: 'bg-green-50 text-green-600' },
  questionnaire:           { label: 'Questionnaire',   icon: ClipboardList, color: 'bg-purple-50 text-purple-600' },
  job_description_initial: { label: 'Job Brief',       icon: Briefcase,     color: 'bg-amber-50 text-amber-600' },
  job_description_detailed:{ label: 'Job Description', icon: Briefcase,     color: 'bg-orange-50 text-orange-600' },
  call_transcript:         { label: 'Call Transcript', icon: MessageSquare, color: 'bg-indigo-50 text-indigo-600' },
  domain_knowledge:        { label: 'Domain Research', icon: Brain,         color: 'bg-teal-50 text-teal-600' },
  spreadsheet:             { label: 'Spreadsheet',     icon: Table2,        color: 'bg-emerald-50 text-emerald-600' },
}

interface SourcesListProps {
  sources: DataSource[]
  onDeleted: (id: string) => void
  onToggled: (id: string, enabled: boolean) => void
}

function SourceRow({
  source,
  onDelete,
  onToggle,
  onView,
  deleting,
  toggling,
}: {
  source: DataSource
  onDelete: () => void
  onToggle: () => void
  onView: () => void
  deleting: boolean
  toggling: boolean
}) {
  const config = SOURCE_CONFIG[source.type]
  const Icon = config.icon
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-opacity ${source.enabled ? 'bg-card' : 'bg-muted/30 opacity-60'}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${config.color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{source.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.color}`}>
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(source.created_at), { addSuffix: true })}
          </span>
          {source.has_embedding && (
            <span title="Indexed in vector store" className="flex items-center gap-0.5 text-xs text-teal-600">
              <Sparkles className="h-3 w-3" />
              Indexed
            </span>
          )}
          {source.status === 'error' && (
            <Badge variant="destructive" className="text-xs">Error</Badge>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={onView}
        title="View content"
      >
        <Eye className="h-4 w-4" />
      </Button>
      <Switch
        checked={source.enabled}
        onCheckedChange={onToggle}
        disabled={toggling}
        aria-label={source.enabled ? 'Disable source' : 'Enable source'}
        className="shrink-0"
      />
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        disabled={deleting}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

export default function SourcesList({ sources, onDeleted, onToggled }: SourcesListProps) {
  const [deleting, setDeleting] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [viewingSource, setViewingSource] = useState<DataSource | null>(null)
  const [viewContent, setViewContent] = useState<string>('')
  const [loadingView, setLoadingView] = useState(false)

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      onDeleted(id)
      toast.success('Source removed')
    } catch {
      toast.error('Failed to remove source')
    } finally {
      setDeleting(null)
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    setToggling(id)
    try {
      const res = await fetch(`/api/sources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error('Failed to update')
      onToggled(id, enabled)
    } catch {
      toast.error('Failed to update source')
    } finally {
      setToggling(null)
    }
  }

  async function handleView(source: DataSource) {
    setViewingSource(source)
    setViewContent('')
    setLoadingView(true)
    try {
      const res = await fetch(`/api/sources/${source.id}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setViewContent(data.content ?? 'No content available.')
    } catch {
      setViewContent('Failed to load content.')
    } finally {
      setLoadingView(false)
    }
  }

  if (!sources.length) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No sources yet. Add your first source above.
      </p>
    )
  }

  const active   = sources.filter(s => s.enabled)
  const disabled = sources.filter(s => !s.enabled)

  return (
    <>
      <div className="space-y-6">
        {/* Active sources */}
        <div className="space-y-2">
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              All sources are disabled. Enable at least one to use in analysis.
            </p>
          )}
          {active.map(source => (
            <SourceRow
              key={source.id}
              source={source}
              onDelete={() => handleDelete(source.id)}
              onToggle={() => handleToggle(source.id, false)}
              onView={() => handleView(source)}
              deleting={deleting === source.id}
              toggling={toggling === source.id}
            />
          ))}
        </div>

        {/* Disabled sources */}
        {disabled.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Disabled ({disabled.length})
            </p>
            {disabled.map(source => (
              <SourceRow
                key={source.id}
                source={source}
                onDelete={() => handleDelete(source.id)}
                onToggle={() => handleToggle(source.id, true)}
                onView={() => handleView(source)}
                deleting={deleting === source.id}
                toggling={toggling === source.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Content viewer sheet */}
      <Sheet open={viewingSource !== null} onOpenChange={open => { if (!open) setViewingSource(null) }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-base">{viewingSource?.title}</SheetTitle>
            {viewingSource && (
              <p className="text-xs text-muted-foreground">
                {SOURCE_CONFIG[viewingSource.type].label} · {formatDistanceToNow(new Date(viewingSource.created_at), { addSuffix: true })}
              </p>
            )}
          </SheetHeader>
          {loadingView ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <MarkdownViewer content={viewContent} />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
