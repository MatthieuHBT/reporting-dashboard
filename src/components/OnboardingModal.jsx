import { useState, useEffect } from 'react'
import { KeyRound, Save, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import './OnboardingModal.css'

export default function OnboardingModal({
  needsOnboarding,
  needsFirstSync,
  onMetaTokenChange,
  onRunFirstSync,
  onFirstSyncDone,
  isRefreshing,
}) {
  const [token, setToken] = useState('')
  const [configured, setConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [firstSyncError, setFirstSyncError] = useState('')

  useEffect(() => {
    if (needsOnboarding) {
      api.settings.metaToken.get()
        .then((r) => setConfigured(!!r.configured))
        .catch(() => setConfigured(false))
    }
  }, [needsOnboarding])

  const step = needsOnboarding ? 1 : 2

  const handleSaveToken = async (e) => {
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

  const handleRunFirstSync = async () => {
    setFirstSyncError('')
    try {
      await onRunFirstSync?.()
      onFirstSyncDone?.()
    } catch (e) {
      setFirstSyncError(e?.message || 'Sync failed')
    }
  }

  return (
    <div className="onboarding-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-modal-card">
        <div className="onboarding-modal-progress">
          <span className="onboarding-step-indicator">Step {step} of 2</span>
        </div>
        <h2 id="onboarding-title" className="onboarding-modal-title">
          {step === 1 ? 'Set up your workspace' : 'Almost there'}
        </h2>
        <p className="onboarding-modal-subtitle">
          {step === 1
            ? 'Connect your Meta Ads account to load campaign data.'
            : 'Run your first sync to import the last 30 days of data.'}
        </p>

        {step === 1 && (
          <div className="onboarding-modal-body">
            <form onSubmit={handleSaveToken} className="onboarding-form">
              <label htmlFor="onboarding-meta-token">Meta API access token</label>
              <p className="onboarding-help">
                <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">
                  Graph API Explorer <ExternalLink size={14} />
                </a>
                {' — permissions: ads_management, ads_read, business_management'}
              </p>
              <textarea
                id="onboarding-meta-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={configured ? '•••••••• (already set)' : 'EAAxxxx...'}
                rows={3}
                disabled={saving}
                className="onboarding-textarea"
              />
              {configured && <span className="onboarding-badge">Configured</span>}
              <div className="onboarding-actions">
                <button
                  type="button"
                  onClick={handleTestToken}
                  disabled={testing}
                  className="onboarding-btn outline"
                >
                  {testing ? <span className="spinner" /> : 'Test token'}
                </button>
                <button
                  type="submit"
                  disabled={saving || !token.trim()}
                  className="onboarding-btn primary"
                >
                  {saving ? <span className="spinner" /> : <Save size={18} />}
                  {success ? 'Saved' : 'Save & continue'}
                </button>
              </div>
              {testResult && (
                <div className={testResult.ok ? 'onboarding-success' : 'onboarding-error'}>
                  {testResult.ok ? '✓' : <AlertCircle size={16} />}
                  {testResult.message}
                </div>
              )}
              {error && (
                <div className="onboarding-error">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </form>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-modal-body">
            <p className="onboarding-desc">
              This will sync campaigns and spend from Meta for the last 7 days. It may take a minute.
            </p>
            <button
              type="button"
              className="onboarding-btn primary onboarding-sync-btn"
              disabled={isRefreshing}
              onClick={handleRunFirstSync}
            >
              {isRefreshing ? <span className="spinner" /> : <RefreshCw size={18} />}
              {isRefreshing ? 'Syncing…' : 'Sync from Meta (7 days)'}
            </button>
            {firstSyncError && (
              <div className="onboarding-error">
                <AlertCircle size={16} />
                {firstSyncError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
