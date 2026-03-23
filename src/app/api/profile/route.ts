import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, github_username, github_connected_at')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({
    email: user.email,
    full_name: profile?.full_name ?? null,
    github_username: profile?.github_username ?? null,
    github_connected_at: profile?.github_connected_at ?? null,
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { full_name, email, password, current_password } = body as { full_name?: string; email?: string; password?: string; current_password?: string }

  // Update full name
  if (full_name !== undefined) {
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: full_name?.trim() || null })
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!email && !password) return NextResponse.json({ message: 'Name updated' })
  }

  // Update email (use session-based auth to trigger confirmation flow)
  if (email) {
    const { error } = await supabase.auth.updateUser({ email })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ message: 'Check your inbox to confirm the new email address.' })
  }

  // Update password
  if (password) {
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    if (!current_password) {
      return NextResponse.json({ error: 'Current password is required' }, { status: 400 })
    }
    if (!user.email) {
      return NextResponse.json({ error: 'Cannot verify password: user has no email' }, { status: 400 })
    }
    // Verify current password first using anon client (requires valid session)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current_password,
    })
    if (signInError) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }
    const admin = await createAdminClient()
    const { error } = await admin.auth.admin.updateUserById(user.id, { password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ message: 'Password updated successfully' })
  }

  return NextResponse.json({ message: 'Profile updated' })
}
