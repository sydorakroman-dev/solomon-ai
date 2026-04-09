'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Eye, EyeOff } from 'lucide-react'

function KeyInput({
  id,
  value,
  placeholder,
  onChange,
  disabled,
}: {
  id: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="pr-10"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        disabled={disabled}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

export default function ProfilePage() {
  const [currentEmail, setCurrentEmail] = useState('')
  const [profileName, setProfileName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [savingPassword, setSavingPassword] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(true)
  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.email) setCurrentEmail(data.email)
        if (data?.full_name) setProfileName(data.full_name)
      })
      .catch(() => null)
      .finally(() => setLoadingProfile(false))
  }, [])

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    setSavingName(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: profileName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Name updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update name')
    } finally {
      setSavingName(false)
    }
  }

  async function handleSaveEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail) return
    setSavingEmail(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(data.message)
      setNewEmail('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update email')
    } finally {
      setSavingEmail(false)
    }
  }

  async function handleSavePassword(e: React.FormEvent) {
    e.preventDefault()
    if (passwordForm.next !== passwordForm.confirm) {
      toast.error('Passwords do not match')
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordForm.next, current_password: passwordForm.current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(data.message)
      setPasswordForm({ current: '', next: '', confirm: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Profile Settings</h1>
        <p className="text-muted-foreground mt-0.5">Update your name, email, and password</p>
      </div>

      <div className="space-y-6">
        {/* Full name */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Display Name</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveName} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="full_name">Full name</Label>
                <Input
                  id="full_name"
                  placeholder="Your name"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  disabled={loadingProfile}
                />
              </div>
              <Button type="submit" size="sm" disabled={savingName || loadingProfile}>
                {savingName ? 'Saving...' : 'Save name'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Email */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Email Address</CardTitle>
            <CardDescription>
              Current email: <span className="font-medium text-foreground">{currentEmail || '—'}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveEmail} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="new_email">New email address</Label>
                <Input
                  id="new_email"
                  type="email"
                  placeholder="new@example.com"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  disabled={loadingProfile}
                />
              </div>
              <Button type="submit" size="sm" disabled={savingEmail || !newEmail || loadingProfile}>
                {savingEmail ? 'Sending...' : 'Send confirmation email'}
              </Button>
              <p className="text-xs text-muted-foreground">
                You will receive a confirmation email at the new address. The change takes effect after you confirm.
              </p>
            </form>
          </CardContent>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSavePassword} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="current_password">Current password</Label>
                <KeyInput
                  id="current_password"
                  placeholder="Current password"
                  value={passwordForm.current}
                  onChange={v => setPasswordForm(f => ({ ...f, current: v }))}
                  disabled={loadingProfile}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new_password">New password</Label>
                <KeyInput
                  id="new_password"
                  placeholder="New password"
                  value={passwordForm.next}
                  onChange={v => setPasswordForm(f => ({ ...f, next: v }))}
                  disabled={loadingProfile}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm_password">Confirm new password</Label>
                <KeyInput
                  id="confirm_password"
                  placeholder="Confirm new password"
                  value={passwordForm.confirm}
                  onChange={v => setPasswordForm(f => ({ ...f, confirm: v }))}
                  disabled={loadingProfile}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={savingPassword || !passwordForm.current || !passwordForm.next || !passwordForm.confirm || loadingProfile}
              >
                {savingPassword ? 'Updating...' : 'Update password'}
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
