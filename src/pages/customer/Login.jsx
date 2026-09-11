import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Chrome, Mail } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'

export default function Login() {
  const {
    signInWithGoogle, sendLoginCode, verifyLoginCode, isLoggedIn, isAdmin,
    loading: authLoading, authError, clearAuthError
  } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [showEmailForm, setShowEmailForm] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeBusy, setCodeBusy] = useState(false)

  // If an account was force-signed-out right after login (e.g. it's
  // suspended), AuthContext leaves a message here for us to show exactly
  // once, then clears it so it doesn't reappear on a later visit.
  useEffect(() => {
    if (authError) {
      setError(authError)
      clearAuthError()
    }
  }, [authError, clearAuthError])

  // Google redirects back to this same page after the user cancels or
  // Google itself reports an error (e.g. "access_denied") - Supabase
  // passes that through as URL query/hash params instead of throwing a
  // JS error we could catch, so without this the page just silently
  // lands back here logged-out with no explanation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash ? window.location.hash.slice(1) : window.location.search)
    const oauthError = params.get('error_description') || params.get('error')
    if (oauthError) {
      setError(decodeURIComponent(oauthError.replace(/\+/g, ' ')))
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // If this account is an admin, always land in the admin panel - even
  // if this customer login screen is what happened to load first (e.g.
  // a phone's home-screen icon or a bookmark pointing at the customer
  // site instead of /admin). Without this, an admin who signs in here
  // ends up dropped into the customer app instead of their own panel.
  useEffect(() => {
    if (!authLoading && isLoggedIn) {
      navigate(isAdmin ? '/admin' : (location.state?.from || '/'), { replace: true })
    }
  }, [authLoading, isLoggedIn, isAdmin, location.state, navigate])

  // Wait for the admin-role lookup to finish before deciding where to
  // send a logged-in user. Without this wait, an admin account would
  // flash "isAdmin: false" (it hasn't loaded yet) and get sent into the
  // customer app instead of /admin.
  if (authLoading || isLoggedIn) return <Loader />

  async function handleGoogle() {
    setError('')
    setLoading(true)
    try {
      // Pass along wherever the user was actually trying to go (e.g. they
      // hit "Add Funds" while logged out) so Google sign-in lands them
      // back there instead of always dropping them on the home page.
      await signInWithGoogle(location.state?.from || '/')
    } catch (e) {
      setError(e.message || 'Could not start Google sign-in.')
      setLoading(false)
    }
  }

  async function handleSendCode() {
    setError('')
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }
    setCodeBusy(true)
    try {
      await sendLoginCode(email.trim())
      setCodeSent(true)
    } catch (e) {
      setError(e.message || 'Could not send the code. Please try again.')
    } finally {
      setCodeBusy(false)
    }
  }

  async function handleVerifyCode() {
    setError('')
    if (!code.trim()) {
      setError('Please enter the code sent to your email.')
      return
    }
    setCodeBusy(true)
    try {
      await verifyLoginCode(email.trim(), code.trim())
      // isLoggedIn will flip true and the component re-renders into the redirect above
    } catch (e) {
      setError(e.message || 'That code is incorrect or expired. Please try again.')
    } finally {
      setCodeBusy(false)
    }
  }

  return (
    <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', minHeight: '80dvh', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: 34 }}>
        <img
          src="/icons/icon-192.png"
          alt="BHD Films"
          style={{
            width: 64,
            height: 64,
            margin: '0 auto 16px',
            borderRadius: 18,
            display: 'block'
          }}
        />
        <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>Welcome to BHD Films</h1>
        <p className="text-dim" style={{ fontSize: 13, margin: 0 }}>
          Sign in to manage your wallet, place orders and track everything in one place.
        </p>
      </div>

      {!showEmailForm && (
        <>
          <button className="btn btn-secondary" onClick={handleGoogle} disabled={loading}>
            <Chrome size={18} /> {loading ? 'Redirecting…' : 'Continue with Google'}
          </button>

          <button
            className="btn btn-secondary"
            style={{ marginTop: 10 }}
            onClick={() => {
              setError('')
              setShowEmailForm(true)
            }}
          >
            <Mail size={18} /> Sign in with email code
          </button>
        </>
      )}

      {showEmailForm && !codeSent && (
        <div>
          <span className="field-label">Email address</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
          />
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={handleSendCode} disabled={codeBusy}>
            {codeBusy ? 'Sending…' : 'Send me a code'}
          </button>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 8 }}
            onClick={() => {
              setError('')
              setShowEmailForm(false)
            }}
          >
            Back
          </button>
        </div>
      )}

      {showEmailForm && codeSent && (
        <div>
          <p className="text-faint" style={{ fontSize: 12, marginBottom: 10 }}>
            We sent a 6-digit code to <strong>{email}</strong>. Enter it below (check spam/promotions if you don't see it).
          </p>
          <span className="field-label">Enter code</span>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoFocus
          />
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={handleVerifyCode} disabled={codeBusy}>
            {codeBusy ? 'Verifying…' : 'Verify & Sign In'}
          </button>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 8 }}
            onClick={handleSendCode}
            disabled={codeBusy}
          >
            Resend code
          </button>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 8 }}
            onClick={() => {
              setError('')
              setCodeSent(false)
              setCode('')
            }}
          >
            Use a different email
          </button>
        </div>
      )}

      {error && <div className="field-error" style={{ textAlign: 'center', marginTop: 12 }}>{error}</div>}

      <p className="text-faint" style={{ fontSize: 11, textAlign: 'center', marginTop: 22 }}>
        By continuing you agree to our{' '}
        <span
          className="text-gold"
          style={{ textDecoration: 'underline', cursor: 'pointer' }}
          onClick={() => navigate('/terms')}
          role="button"
          tabIndex={0}
        >
          Terms &amp; Conditions
        </span>
        .
      </p>
    </div>
  )
}
