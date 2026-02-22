import { useState } from 'react'
import { LogIn, AlertCircle } from 'lucide-react'
import { api, setStoredToken } from '../api/client'
import './Login.css'

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('signin') // signin | signup
  const isSignup = mode === 'signup'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (isSignup && !name.trim()) {
      setError('Name is required')
      return
    }
    if (!email.trim() || !password.trim()) {
      setError('Email and password required')
      return
    }
    setLoading(true)
    try {
      try {
        if (isSignup) {
          const data = await api.auth.db.signup(email.trim(), password, name.trim())
          setStoredToken(data.token)
          const user = { ...data.user, pages: data.user.pages || [] }
          onLogin({ isDemo: false, user, dbMode: true, goToSettings: true })
          return
        }
        const data = await api.auth.db.login(email.trim(), password)
        setStoredToken(data.token)
        const user = { ...data.user, pages: data.user.pages || [] }
        onLogin({ isDemo: false, user, dbMode: true })
        return
      } catch (dbErr) {
        if (dbErr.message?.includes('503') || dbErr.message?.includes('not configured')) {
          setError('Database not configured.')
          return
        }
        if (dbErr.message?.includes('401') || dbErr.message?.includes('Invalid')) {
          setError('Invalid email or password')
          return
        }
        if (dbErr.message?.includes('409') || dbErr.message?.toLowerCase?.().includes('already exists')) {
          setError('Email already in use')
          return
        }
        throw dbErr
      }
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-logo-icon">VP</span>
          <span className="login-logo-text">Advertising Report</span>
        </div>
        <h2>{isSignup ? 'Create account' : 'Sign in'}</h2>
        <p className="login-subtitle">
          {isSignup ? 'Create your account, then connect your Meta API token to continue.' : 'Use your email + password. Meta token is managed in Settings.'}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          {isSignup && (
            <>
              <label htmlFor="name">Name</label>
              <input
                id="name"
                name="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                disabled={loading}
              />
            </>
          )}
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@velunapets.com"
            disabled={loading}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
          />
          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} className="login-btn">
            {loading ? (
              <span className="login-spinner" />
            ) : (
              <>
                <LogIn size={20} />
                {isSignup ? 'Create account' : 'Sign in'}
              </>
            )}
          </button>

          <div className="login-switch">
            {isSignup ? (
              <>
                Already have an account?
                <button type="button" className="login-link" disabled={loading} onClick={() => { setError(''); setMode('signin') }}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                No account yet?
                <button type="button" className="login-link" disabled={loading} onClick={() => { setError(''); setMode('signup') }}>
                  Create account
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
