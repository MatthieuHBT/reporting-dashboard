import { useState } from 'react'
import { LogIn, AlertCircle } from 'lucide-react'
import { api, setStoredToken } from '../api/client'
import './Login.css'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password.trim()) {
      setError('Email and password required')
      return
    }
    setLoading(true)
    try {
      try {
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
        <h2>Sign in</h2>
        <p className="login-subtitle">
          Email and password. Meta token is configured in Settings after login.
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@velunapets.com"
            disabled={loading}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
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
                Sign in
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
