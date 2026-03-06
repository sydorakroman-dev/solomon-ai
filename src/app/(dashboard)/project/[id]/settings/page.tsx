'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, Sliders } from 'lucide-react'
import ProjectMembersPanel from '@/components/project/ProjectMembersPanel'
import type { PromptStage } from '@/types'

const STAGES: { value: PromptStage; label: string; description: string }[] = [
  { value: 'charter', label: 'Charter', description: 'Prompt used when generating the Project Charter' },
  { value: 'prd', label: 'PRD', description: 'Prompt used when generating the PRD' },
  { value: 'epics', label: 'Epics', description: 'Prompt used when generating Epics' },
  { value: 'stories', label: 'Stories', description: 'Prompt used when generating User Stories' },
  { value: 'domain_research', label: 'Domain Research', description: 'Prompt used by the Domain Research Agent' },
]

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const [prompts, setPrompts] = useState<Record<PromptStage, string>>({
    charter: '', prd: '', epics: '', stories: '', domain_research: '',
  })
  const [systemDefaults, setSystemDefaults] = useState<Record<PromptStage, string>>({
    charter: '', prd: '', epics: '', stories: '', domain_research: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<PromptStage | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/project-prompts?project_id=${id}`).then(r => r.json()),
      fetch('/api/system-prompts').then(r => r.json()),
    ]).then(([projectPrompts, sysPrompts]) => {
      if (Array.isArray(projectPrompts)) {
        const map: Record<string, string> = {}
        projectPrompts.forEach((p: { stage: string; content: string }) => { map[p.stage] = p.content })
        setPrompts(prev => ({ ...prev, ...map }))
      }
      if (Array.isArray(sysPrompts)) {
        const map: Record<string, string> = {}
        sysPrompts.forEach((p: { stage: string; content: string }) => { map[p.stage] = p.content })
        setSystemDefaults(prev => ({ ...prev, ...map }))
      }
    }).finally(() => setLoading(false))
  }, [id])

  async function handleSave(stage: PromptStage) {
    setSaving(stage)
    try {
      const res = await fetch('/api/project-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: id, stage, content: prompts[stage] }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success(`${stage} prompt saved`)
    } catch { toast.error('Failed to save prompt') }
    finally { setSaving(null) }
  }

  async function handleReset(stage: PromptStage) {
    setPrompts(prev => ({ ...prev, [stage]: '' }))
    await fetch('/api/project-prompts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: id, stage }),
    })
    toast.success('Reset to system default')
  }

  if (loading) return <div className="p-8 text-muted-foreground text-sm">Loading...</div>

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Project Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Manage collaborators and AI prompt overrides for this project.
        </p>
      </div>

      <Tabs defaultValue="members">
        <TabsList className="mb-6">
          <TabsTrigger value="members" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />Members
          </TabsTrigger>
          <TabsTrigger value="prompts" className="gap-1.5">
            <Sliders className="h-3.5 w-3.5" />Prompts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Team Members</CardTitle>
              <CardDescription>
                Invite collaborators to view or edit this project. Editors have full access; viewers can only read.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectMembersPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prompts">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prompt Overrides</CardTitle>
              <CardDescription>
                These prompts override the system defaults for this project only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="charter">
                <TabsList className="w-full mb-4">
                  {STAGES.map(s => (
                    <TabsTrigger key={s.value} value={s.value} className="flex-1 text-xs">{s.label}</TabsTrigger>
                  ))}
                </TabsList>
                {STAGES.map(stage => (
                  <TabsContent key={stage.value} value={stage.value} className="space-y-3">
                    <p className="text-sm text-muted-foreground">{stage.description}</p>

                    {systemDefaults[stage.value] && (
                      <div className="rounded-lg bg-muted/40 p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-1">System default:</p>
                        <p className="text-xs text-muted-foreground">{systemDefaults[stage.value]}</p>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label>Project override</Label>
                      <Textarea
                        placeholder="Leave blank to use system default. Override for this project..."
                        value={prompts[stage.value]}
                        onChange={e => setPrompts(prev => ({ ...prev, [stage.value]: e.target.value }))}
                        rows={6}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleSave(stage.value)} disabled={saving === stage.value}>
                        {saving === stage.value ? 'Saving...' : 'Save override'}
                      </Button>
                      {prompts[stage.value] && (
                        <Button size="sm" variant="ghost" onClick={() => handleReset(stage.value)}>
                          Reset to default
                        </Button>
                      )}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
