import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Chrome, LogIn, Mail } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'

export default function AdminLogin() {
  const { signInWithGoogle, signInWithPassword, sendLoginCode, verifyLoginCode, isLoggedIn, isAdmin, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [showCodeForm, setShowCodeForm] = useState(false)
  const [codeEmail, setCodeEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeBusy, setCodeBusy] = useState(false)

  if (loading) return <Loader />

  if (isLoggedIn && isAdmin) {
    navigate('/admin', { replace: true })
    return null
  }

  async function handleGoogle() {
    setError('')
    try {
      await signInWithGoogle('/admin')
    } catch (e) {
      setError(e.message || 'Could not start Google sign-in.')
    }
  }

  async function handlePasswordLogin(e) {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Enter both your email and password.')
      return
    }
    setSubmitting(true)
    try {
      await signInWithPassword(email.trim(), password)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err.message || 'Could not log in. Check your email and password.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSendCode() {
    setError('')
    if (!codeEmail.trim() || !codeEmail.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }
    setCodeBusy(true)
    try {
      await sendLoginCode(codeEmail.trim())
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
      await verifyLoginCode(codeEmail.trim(), code.trim())
      navigate('/admin', { replace: true })
    } catch (e) {
      setError(e.message || 'That code is incorrect or expired. Please try again.')
    } finally {
      setCodeBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, background: '#08070c' }}>
      <motion.img
        src="/icons/icon-192.png"
        alt="BHD Films"
        style={{ width: 72, height: 72, borderRadius: 20, marginBottom: 16 }}
        animate={{ scale: [1, 1.045, 1], filter: ['drop-shadow(0 0 6px rgba(212,175,55,0.35))', 'drop-shadow(0 0 16px rgba(212,175,55,0.6))', 'drop-shadow(0 0 6px rgba(212,175,55,0.35))'] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <h1 style={{ fontSize: 19, margin: '0 0 6px', color: 'var(--text)' }}>BHD Films Admin</h1>
      <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 22 }}>Authorized personnel only.</p>

      {isLoggedIn && !isAdmin && (
        <p className="text-danger" style={{ fontSize: 12.5, marginBottom: 14, maxWidth: 300, textAlign: 'center' }}>
          This account does not have admin access. Ask a Super Admin to grant it, or sign in with a different account.
        </p>
      )}

      {!showCodeForm && (
        <>
          <form onSubmit={handlePasswordLogin} style={{ width: '100%', maxWidth: 280 }}>
            <div style={{ marginBottom: 10 }}>
              <span className="field-label">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <span className="field-label">Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
              <LogIn size={18} /> {submitting ? 'Logging in…' : 'Log In'}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 280, margin: '18px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="text-faint" style={{ fontSize: 11 }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <button className="btn btn-secondary" style={{ maxWidth: 280, width: '100%', marginBottom: 10 }} onClick={handleGoogle}>
            <Chrome size={18} /> Continue with Google
          </button>

          <button
            className="btn btn-secondary"
            style={{ maxWidth: 280, width: '100%' }}
            onClick={() => {
              setError('')
              setShowCodeForm(true)
            }}
          >
            <Mail size={18} /> Sign in with email code
          </button>
        </>
      )}

      {showCodeForm && !codeSent && (
        <div style={{ width: '100%', maxWidth: 280 }}>
          <span className="field-label">Email address</span>
          <input
            type="email"
            value={codeEmail}
            onChange={(e) => setCodeEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
          />
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={handleSendCode} disabled={codeBusy}>
            {codeBusy ? 'Sending…' : 'Send me a code'}
          </button>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => {
              setError('')
              setShowCodeForm(false)
            }}
          >
            Back
          </button>
        </div>
      )}

      {showCodeForm && codeSent && (
        <div style={{ width: '100%', maxWidth: 280 }}>
          <p className="text-faint" style={{ fontSize: 12, marginBottom: 10 }}>
            We sent a 6-digit code to <strong>{codeEmail}</strong>. Enter it below (check spam/promotions if you don't see it).
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
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={handleVerifyCode} disabled={codeBusy}>
            {codeBusy ? 'Verifying…' : 'Verify & Log In'}
          </button>
          <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={handleSendCode} disabled={codeBusy}>
            Resend code
          </button>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', marginTop: 8 }}
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

      {error && <div className="field-error">{error}</div>}
    </div>
  )
}
