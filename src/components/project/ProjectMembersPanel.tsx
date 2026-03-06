'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { UserPlus, Trash2, Mail, Crown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { ProjectMember, ProjectInvitation, MemberRole } from '@/types'

interface MembersData {
  isOwner: boolean
  members: ProjectMember[]
  invitations: ProjectInvitation[]
}

const ROLE_COLORS: Record<MemberRole, string> = {
  editor: 'bg-blue-50 text-blue-700 border-blue-200',
  viewer: 'bg-zinc-50 text-zinc-600 border-zinc-200',
}

export default function ProjectMembersPanel() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<MembersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MemberRole>('editor')
  const [inviting, setInviting] = useState(false)

  async function load() {
    const res = await fetch(`/api/projects/${id}/members`)
    if (res.ok) setData(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      const res = await fetch(`/api/projects/${id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      if (result.status === 'added') {
        toast.success(`${inviteEmail} added to project`)
      } else {
        toast.success(`Invite sent to ${inviteEmail}`)
      }
      setInviteEmail('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to invite')
    } finally {
      setInviting(false)
    }
  }

  async function handleRoleChange(userId: string, role: MemberRole) {
    const res = await fetch(`/api/projects/${id}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      setData(prev => prev ? {
        ...prev,
        members: prev.members.map(m => m.user_id === userId ? { ...m, role } : m),
      } : prev)
      toast.success('Role updated')
    }
  }

  async function handleRemoveMember(userId: string) {
    const res = await fetch(`/api/projects/${id}/members/${userId}`, { method: 'DELETE' })
    if (res.ok) {
      setData(prev => prev ? { ...prev, members: prev.members.filter(m => m.user_id !== userId) } : prev)
      toast.success('Member removed')
    }
  }

  async function handleCancelInvite(invId: string) {
    const res = await fetch(`/api/projects/${id}/invitations/${invId}`, { method: 'DELETE' })
    if (res.ok) {
      setData(prev => prev ? { ...prev, invitations: prev.invitations.filter(i => i.id !== invId) } : prev)
      toast.success('Invitation cancelled')
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground p-1">Loading members...</div>
  if (!data) return null

  const { isOwner, members, invitations } = data

  return (
    <div className="space-y-6">
      {/* Invite form */}
      {isOwner && (
        <form onSubmit={handleInvite} className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium">Invite by email</label>
            <Input
              type="email"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              required
            />
          </div>
          <Select value={inviteRole} onValueChange={v => setInviteRole(v as MemberRole)}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={inviting}>
            <UserPlus className="h-4 w-4" />
            {inviting ? 'Sending...' : 'Invite'}
          </Button>
        </form>
      )}

      {/* Active members */}
      <div>
        <h3 className="text-sm font-medium mb-2">Members</h3>
        <div className="space-y-1.5">
          {/* Owner row — always first */}
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span className="text-sm font-medium truncate">You (owner)</span>
            </div>
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Owner</Badge>
          </div>

          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div className="min-w-0 flex-1 mr-2">
                {member.name && <p className="text-sm font-medium truncate">{member.name}</p>}
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                  <Mail className="h-3 w-3 shrink-0" />
                  {member.email}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isOwner ? (
                  <Select value={member.role} onValueChange={v => handleRoleChange(member.user_id, v as MemberRole)}>
                    <SelectTrigger className={`h-7 text-xs border px-2 w-auto ${ROLE_COLORS[member.role]}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className={`text-xs ${ROLE_COLORS[member.role]}`}>
                    {member.role}
                  </Badge>
                )}
                {isOwner && (
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveMember(member.user_id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}

          {members.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No collaborators yet.</p>
          )}
        </div>
      </div>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Pending invitations</h3>
          <div className="space-y-1.5">
            {invitations.map(inv => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground truncate">{inv.email}</span>
                  <Badge variant="outline" className={`text-xs shrink-0 ${ROLE_COLORS[inv.role]}`}>{inv.role}</Badge>
                </div>
                {isOwner && (
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => handleCancelInvite(inv.id)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
