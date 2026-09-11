import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [adminRole, setAdminRole] = useState(null) // null | 'super_admin' | 'admin' | 'staff'
  const [adminPermissions, setAdminPermissions] = useState({})
  const [loading, setLoading] = useState(true)
  // True any time we're (re)loading the profile/admin-role for the
  // CURRENT session - not just on first page load. Without this, right
  // after a fresh login the app briefly has isLoggedIn=true but
  // adminRole still null (the admin_users lookup hasn't finished yet),
  // so an admin could get bounced to the customer app for a split
  // second before the real role loads. Routes wait on this too (see
  // the combined "loading" below) so that race can't happen.
  const [profileLoading, setProfileLoading] = useState(false)
  // Set (with a customer-facing message) whenever we had to force-sign-out
  // an account right after login - e.g. it was suspended by an admin.
  // Login.jsx reads this once and shows it as the error under the form.
  const [authError, setAuthError] = useState('')

  const loadProfile = useCallback(async (userId, opts = {}) => {
    // "silent" is used for the automatic hourly background token refresh
    // (see onAuthStateChange below) - we still want to re-check the
    // profile/admin role then (e.g. in case the account got suspended
    // meanwhile), just without flipping the app-wide loading flag, which
    // would unmount whatever protected page the customer is on and lose
    // anything they were mid-typing (Add Funds amount, a support ticket,
    // etc.) for no reason - nothing about their session actually changed.
    const silent = !!opts.silent
    if (!userId) {
      setProfile(null)
      setAdminRole(null)
      setAdminPermissions({})
      return
    }
    if (!silent) setProfileLoading(true)
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      // A suspended customer account must not actually be able to use the
      // app - admins toggle this from Customer Detail expecting it to
      // really lock the account out, not just show a badge. Catch it
      // right here, the one place every login (Google + email code) and
      // every silent token refresh passes through, so it can't be
      // bypassed by any route. We deliberately never setProfile(...) with
      // the suspended row, so nothing downstream briefly treats them as a
      // signed-in customer.
      if (profileData?.account_status === 'suspended') {
        setProfile(null)
        setAdminRole(null)
        setAdminPermissions({})
        setAuthError('Your account has been suspended. Please contact support for help.')
        setSession(null)
        await supabase.auth.signOut()
        return
      }

      setProfile(profileData)

      // If this browser is carrying a referral code from a ?ref= link
      // (see ReferralCapture.jsx), try to claim it now - exactly once.
      // Removing it from localStorage immediately (before the RPC even
      // finishes) is what makes this "once": the next login/session
      // restore won't find a code to retry, so it can't be claimed twice
      // for the same visit even if this call fails. The RPC itself is
      // also safe to call more than once regardless (it just reports
      // 'already_claimed'/'not_eligible' instead of erroring), and it's
      // fine for it to run again on a genuinely new later signup by the
      // same browser (each account gets its own independent attempt).
      try {
        const pendingRefCode = localStorage.getItem('bhd_ref_code')
        if (pendingRefCode) {
          localStorage.removeItem('bhd_ref_code')
          supabase.rpc('claim_referral_code', { p_code: pendingRefCode }).then(() => {})
        }
      } catch {
        // localStorage unavailable - nothing to claim, nothing to break.
      }

      const { data: adminData } = await supabase
        .from('admin_users')
        .select('role, permissions')
        .eq('id', userId)
        .maybeSingle()
      setAdminRole(adminData?.role || null)
      setAdminPermissions(adminData?.permissions || {})
    } finally {
      if (!silent) setProfileLoading(false)
    }
  }, [])

  const clearAuthError = useCallback(() => setAuthError(''), [])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return
      setSession(s)
      loadProfile(s?.user?.id).finally(() => setLoading(false))
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      loadProfile(s?.user?.id, { silent: event === 'TOKEN_REFRESHED' })
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signInWithGoogle = useCallback(async (redirectPath = '/') => {
    const redirectTo = `${window.location.origin}${redirectPath}`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    })
    if (error) throw error
  }, [])

  const signInWithPassword = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  // Sends a 6-digit login code to the customer's email (works for both
  // brand new customers and returning ones - Supabase creates the
  // account automatically the first time). Step 1 of the email-code
  // sign-in flow.
  const sendLoginCode = useCallback(async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true }
    })
    if (error) throw error
  }, [])

  // Verifies the 6-digit code the customer typed in. Step 2 - this
  // actually logs them in (or finishes registering them, if new).
  const verifyLoginCode = useCallback(async (email, code) => {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) throw error
  }, [])

  // Sets/changes a password on the CURRENTLY logged-in account (e.g. one
  // that originally only had Google sign-in). After this, the same
  // account can log in either with Google or with email+password.
  const updatePassword = useCallback(async (newPassword) => {
    // Right after landing on a fresh page (e.g. straight after logging in
    // and being redirected to the dashboard), the Supabase auth library can
    // occasionally not have finished loading the session into its own
    // internal memory yet, even though we're clearly logged in - and the
    // very next call, like this one, would fail with "Auth session
    // missing!". Explicitly asking for the session first forces the
    // library to load/confirm it before we try to change the password, so
    // that split-second timing gap can't cause this call to fail.
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      throw new Error('Your login session is not ready yet. Please wait a moment and try again.')
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const refreshProfile = useCallback(() => loadProfile(session?.user?.id), [loadProfile, session])

  const value = {
    session,
    user: session?.user || null,
    profile,
    isLoggedIn: !!session?.user,
    adminRole,
    adminPermissions,
    isAdmin: !!adminRole,
    isSuperAdmin: adminRole === 'super_admin',
    loading: loading || profileLoading,
    authError,
    clearAuthError,
    signInWithGoogle,
    signInWithPassword,
    sendLoginCode,
    verifyLoginCode,
    updatePassword,
    signOut,
    refreshProfile
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
