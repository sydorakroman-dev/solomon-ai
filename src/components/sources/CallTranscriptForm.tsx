'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { DataSource } from '@/types'

type Tab = 'upload' | 'paste'

interface Props {
  projectId: string
  onAdded: (source: DataSource) => void
}

export default function CallTranscriptForm({ projectId, onAdded }: Props) {
  const [tab, setTab] = useState<Tab>('upload')
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (tab === 'upload' && !file) return
    if (tab === 'paste' && !text.trim()) return
    setLoading(true)

    try {
      let source: DataSource

      if (tab === 'upload') {
        const formData = new FormData()
        formData.append('file', file!)
        formData.append('project_id', projectId)
        formData.append('type', 'call_transcript')
        formData.append('title', title || file!.name)
        const res = await fetch('/api/sources', { method: 'POST', body: formData })
        if (!res.ok) throw new Error((await res.json()).error)
        source = await res.json()
      } else {
        const res = await fetch('/api/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            type: 'call_transcript',
            title: title.trim() || 'Call transcript',
            content: text,
          }),
        })
        if (!res.ok) throw new Error((await res.json()).error)
        source = await res.json()
      }

      toast.success('Transcript added')
      onAdded(source)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const isDisabled = loading || (tab === 'upload' ? !file : !text.trim())

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex rounded-md border border-border overflow-hidden text-sm">
        {(['upload', 'paste'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-2 font-medium transition-colors ${
              tab === t
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {t === 'upload' ? 'Upload file' : 'Paste text'}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <div className="space-y-1.5">
          <Label>File *</Label>
          <div
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-8 w-8 text-muted-foreground mb-2" />
            {file ? (
              <p className="text-sm font-medium">{file.name}</p>
            ) : (
              <>
                <p className="text-sm font-medium">Click to upload</p>
                <p className="text-xs text-muted-foreground mt-1">TXT, PDF, DOCX</p>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.pdf,.docx"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      {tab === 'paste' && (
        <div className="space-y-1.5">
          <Label htmlFor="transcript-content">Transcript *</Label>
          <Textarea
            id="transcript-content"
            placeholder="Paste your call transcript here..."
            value={text}
            onChange={e => setText(e.target.value)}
            rows={8}
            required
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="transcript-title">Title (optional)</Label>
        <Input
          id="transcript-title"
          placeholder={tab === 'upload' ? 'Uses filename if empty' : 'e.g. Discovery call – Acme Corp'}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isDisabled}>
        {loading ? 'Processing...' : 'Add transcript'}
      </Button>
    </form>
  )
}
