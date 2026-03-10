'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DataSource, SourceType } from '@/types'

const FILE_TYPES: { value: SourceType; label: string; accept: string }[] = [
  { value: 'pdf', label: 'PDF document', accept: '.pdf' },
  { value: 'json_schema', label: 'DB Schema (.json)', accept: '.json' },
  { value: 'job_description_initial', label: 'Initial job brief (.pdf, .txt)', accept: '.pdf,.txt' },
  { value: 'job_description_detailed', label: 'Detailed job description (.pdf, .txt, .doc)', accept: '.pdf,.txt,.doc,.docx' },
  { value: 'spreadsheet', label: 'Spreadsheet (.csv, .xlsx)', accept: '.csv,.xlsx,.xls' },
]

interface Props {
  projectId: string
  onAdded: (source: DataSource) => void
}

export default function FileUploadForm({ projectId, onAdded }: Props) {
  const [loading, setLoading] = useState(false)
  const [selectedType, setSelectedType] = useState<SourceType>('pdf')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const currentType = FILE_TYPES.find(t => t.value === selectedType)!

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('project_id', projectId)
      formData.append('type', selectedType)
      formData.append('title', title || file.name)

      const res = await fetch('/api/sources', { method: 'POST', body: formData })
      if (!res.ok) throw new Error((await res.json()).error)
      const source = await res.json()
      toast.success('File processed and added')
      onAdded(source)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>File type</Label>
        <Select
          value={selectedType}
          onValueChange={v => {
            setSelectedType(v as SourceType)
            setFile(null)
            if (inputRef.current) inputRef.current.value = ''
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILE_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
              <p className="text-xs text-muted-foreground mt-1">{currentType.accept.replace(/\./g, '').toUpperCase()}</p>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={currentType.accept}
          className="hidden"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="file-title">Title (optional)</Label>
        <Input
          id="file-title"
          placeholder="Uses filename if empty"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={loading || !file}>
        {loading ? 'Processing...' : 'Upload & extract'}
      </Button>
    </form>
  )
}
