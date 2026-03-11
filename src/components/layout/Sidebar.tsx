'use client'

import Link from 'next/link'
import { usePathname, useParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard,
  FolderOpen,
  Settings,
  User,
  Users,
  LogOut,
  FileText,
  Database,
  Layers,
  BookOpen,
  ListChecks,
  ChevronLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import type { UserRole } from '@/types'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

const dashboardNav: NavItem[] = [
  { label: 'Projects', href: '/dashboard', icon: LayoutDashboard },
]

const settingsNavAll: NavItem[] = [
  { label: 'Profile', href: '/profile', icon: User },
]

const settingsNavAdmin: NavItem[] = [
  { label: 'System Settings', href: '/settings', icon: Settings },
  { label: 'User Management', href: '/user-management', icon: Users },
]

function projectNav(id: string): NavItem[] {
  return [
    { label: 'Overview', href: `/project/${id}`, icon: FolderOpen },
    { label: 'Sources', href: `/project/${id}/sources`, icon: Database },
    { label: 'Charter', href: `/project/${id}/charter`, icon: FileText },
    { label: 'PRD', href: `/project/${id}/prd`, icon: BookOpen },
    { label: 'Epics', href: `/project/${id}/epics`, icon: Layers },
    { label: 'Stories', href: `/project/${id}/stories`, icon: ListChecks },
    { label: 'Settings', href: `/project/${id}/settings`, icon: Settings },
  ]
}

interface SidebarProps {
  role: UserRole
}

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const params = useParams()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  const projectId = params?.id as string | undefined

  // Track which project the fetched name belongs to so we can derive null safely
  const [fetchedForId, setFetchedForId] = useState<string | undefined>(undefined)
  const [fetchedName, setFetchedName] = useState<string | null>(null)

  // Derive: only use stored name when it matches the current project
  const projectName = fetchedForId === projectId ? fetchedName : null

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    fetch(`/api/projects/${projectId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled) {
          setFetchedName(data?.name ?? 'Project')
          setFetchedForId(projectId)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedName('Project')
          setFetchedForId(projectId)
        }
      })
    return () => { cancelled = true }
  }, [projectId])

  async function handleLogout() {
    setLoggingOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('Signed out')
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  const navItems = projectId ? projectNav(projectId) : dashboardNav

  return (
    <aside className="flex h-screen w-56 flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 border-b border-sidebar-border">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold">
            S
          </div>
          <span className="text-sm font-semibold tracking-wide">Solomon</span>
        </Link>
      </div>

      {/* Project context breadcrumb */}
      {projectId && (
        <div className="px-3 pt-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors mb-1"
          >
            <ChevronLeft className="h-3 w-3" />
            All projects
          </Link>
          <p className="text-xs font-medium text-sidebar-foreground/70 truncate px-1">
            {projectName ?? '…'}
          </p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              isActive(item.href)
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        ))}

      </nav>

      {/* Settings group — always visible */}
      <div className="border-t border-sidebar-border px-2 py-2 space-y-0.5">
        <p className="px-2.5 py-1 text-xs font-medium text-sidebar-foreground/40 uppercase tracking-wider">
          Settings
        </p>
        {[...settingsNavAll, ...(role === 'admin' ? settingsNavAdmin : [])].map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              isActive(item.href)
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        ))}
      </div>

      {/* Logout */}
      <div className="border-t border-sidebar-border p-2">
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {loggingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
