import { useState, useEffect } from 'react'
import { KeyRound, Save, AlertCircle, ExternalLink } from 'lucide-react'
import { api } from '../api/client'
import './Settings.css'

export default function Settings() {
  const [token, setToken] = useState('')
  const [configured, setConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    api.settings.metaToken.get()
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false))
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setSaving(true)
    try {
      await api.settings.metaToken.set(token.trim() || null)
      setConfigured(!!token.trim())
      setSuccess(true)
      setToken('')
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h2><KeyRound size={24} /> Meta API</h2>
      </header>
      <div className="settings-card">
        <p className="settings-desc">
          Token Meta pour le bouton &quot;Refresh from Meta&quot;. Stocké en BDD.
        </p>
        <p className="settings-help">
          <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">
            Graph API Explorer <ExternalLink size={14} />
          </a>
          — permissions : ads_management, ads_read, business_management
        </p>
        <form onSubmit={handleSave} className="settings-form">
          <label htmlFor="meta-token">Access Token</label>
          <textarea
            id="meta-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={configured ? '•••••••• (leave empty to keep current)' : 'EAAxxxx...'}
            rows={3}
            disabled={saving}
          />
          {configured && <span className="settings-badge">Configured</span>}
          {error && (
            <div className="settings-error">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
          <div className="settings-actions">
            <button type="submit" disabled={saving || !token.trim()} className="save-btn">
            {saving ? <span className="spinner" /> : <Save size={18} />}
            {success ? 'Saved' : 'Save'}
          </button>
            {configured && (
              <button
                type="button"
                onClick={async () => {
                  setSaving(true)
                  setError('')
                  try {
                    await api.settings.metaToken.set('')
                    setConfigured(false)
                    setSuccess(true)
                    setTimeout(() => setSuccess(false), 2000)
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setSaving(false)
                  }
                }}
                disabled={saving}
                className="save-btn outline"
              >
                Clear token
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
