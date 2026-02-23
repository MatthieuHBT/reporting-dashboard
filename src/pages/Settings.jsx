import { useState, useEffect } from 'react'
import { KeyRound, Save, AlertCircle, ExternalLink, UserPlus, Trash2, RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import './Settings.css'

export default function Settings({ workspaceId, currentUser, onWorkspaceChange, onMetaTokenChange, needsOnboarding, needsFirstSync, onRunFirstSync, isRefreshing, onFirstSyncDone }) {
  // Section Client visible uniquement si plusieurs clients
  const workspacesEnabled = true

  const [token, setToken] = useState('')
  const [configured, setConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaces, setWorkspaces] = useState([])
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(workspaceId || '')
  const [members, setMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [removingId, setRemovingId] = useState(null)
  const [firstSyncError, setFirstSyncError] = useState('')

  useEffect(() => {
    api.settings.metaToken.get()
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false))
  }, [])

  useEffect(() => {
    if (workspaceId != null) setSelectedWorkspaceId(workspaceId || '')
  }, [workspaceId])

  useEffect(() => {
    setWorkspaceLoading(true)
    setWorkspaceError('')
    api.workspaces.list()
      .then((r) => setWorkspaces(r.workspaces || []))
      .catch((e) => setWorkspaceError(e.message))
      .finally(() => setWorkspaceLoading(false))
  }, [])

  const currentWorkspaceRole = workspaces.find((w) => w.id === selectedWorkspaceId)?.role
  const canManageMembers = currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin'

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setMembers([])
      setMembersError('')
      return
    }
    setMembersLoading(true)
    setMembersError('')
    api.workspaces.members.list()
      .then((r) => setMembers(r.members || []))
      .catch((e) => {
        if (e?.message && (String(e.message).includes('404') || String(e.message).includes('Not Found'))) {
          setMembers([])
          setMembersError('')
        } else {
          setMembersError(e?.message || 'Failed to load members')
        }
      })
      .finally(() => setMembersLoading(false))
  }, [selectedWorkspaceId])

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
            To continue, first configure your Meta API token for this workspace.
          </div>
        )}
        <p className="settings-desc">
          Meta API token used by “Refresh from Meta”. Stored per workspace in the database.
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
                  await api.workspaces.resetAndSync({ campaignDays: 30, includeWinners: false })
                  onFirstSyncDone?.()
                } catch (e) {
                  setFirstSyncError(e?.message || 'Reset+sync failed')
                }
              }}
              title="Purges workspace data then resync (owner only)"
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

      {workspacesEnabled && (
        <div className="settings-card settings-card-spaced">
          <header className="settings-subheader">
            <h3>Client</h3>
          </header>
          <p className="settings-desc">
            Your session is scoped to a client. If you have access to multiple clients, you can switch here.
          </p>

          {workspaceLoading && <p className="settings-desc">Loading…</p>}
          {workspaceError && (
            <div className="settings-error">
              <AlertCircle size={16} />
              {workspaceError}
            </div>
          )}

          <div className="settings-form">
            {workspaces.length > 1 && (
              <>
                <label htmlFor="workspace-select">Client</label>
                <select
                  id="workspace-select"
                  value={selectedWorkspaceId}
                  onChange={(e) => {
                    const v = e.target.value
                    setSelectedWorkspaceId(v)
                    if (onWorkspaceChange) onWorkspaceChange(v || null)
                  }}
                  disabled={workspaceLoading}
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} {w.role ? `(${w.role})` : ''}
                    </option>
                  ))}
                </select>
              </>
            )}

            {(currentUser?.role === 'admin') && (
              <>
                <div className="settings-divider" />
                <label htmlFor="workspace-create">Create a client</label>
                <div className="settings-row">
                  <input
                    id="workspace-create"
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    placeholder="Client name"
                    disabled={workspaceLoading}
                  />
                  <button
                    type="button"
                    className="save-btn"
                    disabled={workspaceLoading || !newWorkspaceName.trim()}
                    onClick={async () => {
                      setWorkspaceLoading(true)
                      setWorkspaceError('')
                      try {
                        const created = await api.workspaces.create(newWorkspaceName.trim())
                        const ws = created.workspace
                        const next = workspaces.some((w) => w.id === ws?.id)
                          ? workspaces.map((w) => (w.id === ws?.id ? { ...w, name: ws.name } : w))
                          : [...workspaces, ws].filter(Boolean)
                        setWorkspaces(next)
                        setNewWorkspaceName('')
                        if (ws?.id) {
                          setSelectedWorkspaceId(ws.id)
                          if (onWorkspaceChange) onWorkspaceChange(ws.id)
                        }
                      } catch (e) {
                        setWorkspaceError(e.message)
                      } finally {
                        setWorkspaceLoading(false)
                      }
                    }}
                  >
                    Create
                  </button>
                </div>
              </>
            )}

            {selectedWorkspaceId && (
              <>
                <div className="settings-divider" />
                <header className="settings-subheader">
                  <h3><UserPlus size={18} /> Members</h3>
                </header>
                <p className="settings-desc">
                  People with access to this client. Only existing users can be added (they must sign up first).
                </p>
                {membersLoading && <p className="settings-desc">Loading…</p>}
                {membersError && (
                  <div className="settings-error">
                    <AlertCircle size={16} />
                    {membersError}
                  </div>
                )}
                {!membersLoading && !membersError && (
                  <ul className="settings-members-list">
                    {members.map((m) => (
                      <li key={m.id} className="settings-members-row">
                        <span className="settings-members-info">
                          {m.name || m.email} {m.name && <span className="settings-members-email">({m.email})</span>}
                          <span className="settings-members-role">{m.role}</span>
                        </span>
                        {canManageMembers && (
                          <button
                            type="button"
                            className="save-btn outline settings-members-remove"
                            disabled={removingId === m.id || (m.role === 'owner' && members.filter((x) => x.role === 'owner').length === 1)}
                            title={m.role === 'owner' && members.filter((x) => x.role === 'owner').length === 1 ? 'Cannot remove the last owner' : 'Remove from workspace'}
                            onClick={async () => {
                              setRemovingId(m.id)
                              setInviteError('')
                              try {
                                await api.workspaces.members.remove(m.id)
                                setMembers((prev) => prev.filter((x) => x.id !== m.id))
                              } catch (e) {
                                setInviteError(e.message)
                              } finally {
                                setRemovingId(null)
                              }
                            }}
                          >
                            {removingId === m.id ? <span className="spinner" /> : <Trash2 size={14} />}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canManageMembers && (
                  <form
                    className="settings-form settings-invite-form"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      if (!inviteEmail.trim()) return
                      setInviteSubmitting(true)
                      setInviteError('')
                      try {
                        const r = await api.workspaces.members.add(inviteEmail.trim(), inviteRole)
                        setMembers((prev) => [...prev, { id: r.user.id, email: r.user.email, name: r.user.name, role: r.user.role }])
                        setInviteEmail('')
                      } catch (err) {
                        setInviteError(err.message)
                      } finally {
                        setInviteSubmitting(false)
                      }
                    }}
                  >
                    <label htmlFor="invite-email">Add member by email</label>
                    <div className="settings-row">
                      <input
                        id="invite-email"
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="colleague@example.com"
                        disabled={inviteSubmitting}
                      />
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value)}
                        disabled={inviteSubmitting}
                        className="settings-role-select"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button type="submit" className="save-btn" disabled={inviteSubmitting || !inviteEmail.trim()}>
                        {inviteSubmitting ? <span className="spinner" /> : <UserPlus size={16} />}
                        Add
                      </button>
                    </div>
                    {inviteError && (
                      <div className="settings-error">
                        <AlertCircle size={16} />
                        {inviteError}
                      </div>
                    )}
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
