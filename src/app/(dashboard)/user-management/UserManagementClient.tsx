'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { Shield, Users, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface AdminUser {
  user_id: string
  email: string
  role: 'admin' | 'user'
  full_name: string | null
  created_at: string
}

interface AdminProject {
  id: string
  name: string
  client_name: string | null
  status: string
  type: string
  user_id: string
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  setup: 'bg-zinc-100 text-zinc-600',
  sources: 'bg-blue-50 text-blue-600',
  charter: 'bg-purple-50 text-purple-600',
  prd: 'bg-indigo-50 text-indigo-600',
  epics: 'bg-amber-50 text-amber-600',
  stories: 'bg-orange-50 text-orange-600',
  approved: 'bg-green-50 text-green-700',
}

export default function UserManagementClient() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingUser, setUpdatingUser] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/users').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch('/api/admin/projects').then(r => r.ok ? r.json() : []),
    ]).then(([u, p]) => {
      setUsers(Array.isArray(u) ? u : [])
      setProjects(Array.isArray(p) ? p : [])
    }).catch(() => {
      // Server-side authorization check will handle 403 responses
    }).finally(() => setLoading(false))
  }, [])

  async function updateRole(userId: string, role: 'admin' | 'user') {
    setUpdatingUser(userId)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, role }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, role } : u))
      toast.success('Role updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update role')
    } finally {
      setUpdatingUser(null)
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground text-sm">Loading...</div>

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage users and projects</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Users className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{users.length}</p>
              <p className="text-xs text-muted-foreground">Total users</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{projects.length}</p>
              <p className="text-xs text-muted-foreground">Total projects</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{users.filter(u => u.role === 'admin').length}</p>
              <p className="text-xs text-muted-foreground">Admins</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="mb-6">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="projects">All Projects</TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Users</CardTitle>
              <CardDescription>Manage user accounts and roles</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Change role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(user => (
                    <TableRow key={user.user_id}>
                      <TableCell className="font-medium text-sm">{user.email}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{user.full_name ?? '—'}</TableCell>
                      <TableCell>
                        <Badge className={user.role === 'admin'
                          ? 'bg-purple-100 text-purple-700 border-purple-200'
                          : 'bg-zinc-100 text-zinc-600 border-zinc-200'}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(user.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={user.role}
                          onValueChange={v => updateRole(user.user_id, v as 'admin' | 'user')}
                          disabled={updatingUser === user.user_id}
                        >
                          <SelectTrigger className="h-7 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Projects Tab */}
        <TabsContent value="projects">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Projects</CardTitle>
              <CardDescription>Projects across all users</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map(project => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium text-sm">{project.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{project.client_name ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{project.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[project.status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                          {project.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(project.created_at), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
