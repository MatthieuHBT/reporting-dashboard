import { useState, useEffect } from 'react'
import { KeyRound, Save, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import './Settings.css'

export default function Settings({ workspaceId, currentUser, onMetaTokenChange, needsOnboarding, needsFirstSync, onRunFirstSync, isRefreshing, onFirstSyncDone }) {
  const [token, setToken] = useState('')
  const [configured, setConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const [firstSyncError, setFirstSyncError] = useState('')

  useEffect(() => {
    api.settings.metaToken.get()
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false))
  }, [])

  const handleTestToken = async () => {
    setError('')
    setTestResult(null)
    setTesting(true)
    try {
      const r = await api.settings.metaToken.test()
      setTestResult({ ok: true, message: r.message || 'Token is valid' })
    } catch (err) {
      setTestResult({ ok: false, message: err.message })
    } finally {
      setTesting(false)
    }
  }

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
      onMetaTokenChange?.()
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
        {needsOnboarding && (
          <div className="settings-warning">
            <AlertCircle size={16} />
            To continue, first configure your Meta API token for this client.
          </div>
        )}
        <p className="settings-desc">
          Meta API token used by “Refresh from Meta”. Stored per client in the database.
        </p>
        <p className="settings-help">
          <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">
            Graph API Explorer <ExternalLink size={14} />
          </a>
          — permissions: ads_management, ads_read, business_management
        </p>
        <form onSubmit={handleSave} className="settings-form">
          <label htmlFor="meta-token">Access Token</label>
          <textarea
            id="meta-token"
            name="metaToken"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={configured ? '•••••••• (leave empty to keep current)' : 'EAAxxxx...'}
            rows={3}
            disabled={saving}
          />
          {configured && <span className="settings-badge">Configured</span>}
          <button
            type="button"
            onClick={handleTestToken}
            disabled={testing}
            className="save-btn outline"
            title="Test your Meta token"
          >
            {testing ? <span className="spinner" /> : 'Test token'}
          </button>
          {testResult && (
            <div className={testResult.ok ? 'settings-success' : 'settings-error'}>
              {testResult.ok ? '✓' : <AlertCircle size={16} />}
              {testResult.message}
            </div>
          )}
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
                    onMetaTokenChange?.()
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

      {needsFirstSync && configured && (
        <div className="settings-card settings-card-spaced settings-first-sync">
          <header className="settings-subheader">
            <h3>Step 2 — First sync</h3>
          </header>
          <p className="settings-desc">
            Run your first sync to load campaign data from Meta (last 30 days). You need to do this once before using reports.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="save-btn settings-first-sync-btn"
              disabled={isRefreshing}
              onClick={async () => {
                setFirstSyncError('')
                try {
                  await onRunFirstSync?.()
                  onFirstSyncDone?.()
                } catch (e) {
                  setFirstSyncError(e?.message || 'Sync failed')
                }
              }}
            >
              {isRefreshing ? <span className="spinner" /> : <RefreshCw size={18} />}
              {isRefreshing ? 'Syncing…' : 'Sync from Meta (30 days)'}
            </button>
            <button
              type="button"
              className="save-btn outline"
              disabled={isRefreshing}
              onClick={async () => {
                setFirstSyncError('')
                try {
                  // Reset du workspace + resync propre (30j). Owner/admin uniquement côté API.
                  await api.client.resetAndSync({ campaignDays: 30, includeWinners: false })
                  onFirstSyncDone?.()
                } catch (e) {
                  setFirstSyncError(e?.message || 'Reset+sync failed')
                }
              }}
              title="Purges client data then resync (owner only)"
            >
              Reset + resync (30 days)
            </button>
          </div>
          {firstSyncError && (
            <div className="settings-error">
              <AlertCircle size={16} />
              {firstSyncError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
