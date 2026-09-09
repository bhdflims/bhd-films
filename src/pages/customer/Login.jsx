import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Clapperboard, Chrome, Mail } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

export default function Login() {
  const { signInWithGoogle, sendLoginCode, verifyLoginCode, isLoggedIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [showEmailForm, setShowEmailForm] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeBusy, setCodeBusy] = useState(false)

  if (isLoggedIn) {
    navigate(location.state?.from || '/', { replace: true })
    return null
  }

  async function handleGoogle() {
    setError('')
    setLoading(true)
    try {
      await signInWithGoogle()
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
        <div
          style={{
            width: 64,
            height: 64,
            margin: '0 auto 16px',
            borderRadius: 18,
            background: 'linear-gradient(135deg,var(--gold),var(--crimson))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Clapperboard size={30} color="#170f08" />
        </div>
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
        By continuing you agree to our Terms and Privacy Policy.
      </p>
    </div>
  )
}
