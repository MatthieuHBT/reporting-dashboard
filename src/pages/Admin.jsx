import { useState, useEffect, useCallback } from 'react'
import { Users, Save, Shield, User, Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { PAGE_IDS, PAGE_LABELS } from '../data/members'
import './Admin.css'

export default function Admin({ dbMode, onSave }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [newMember, setNewMember] = useState({ name: '', email: '', password: 'VpTeam2026!', role: 'team', pages: ['spend'] })

  const fetchMembers = useCallback(async () => {
    if (!dbMode) return
    setLoading(true)
    try {
      const list = await api.users.list()
      setMembers(list)
    } catch {
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [dbMode])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  const handleTogglePage = (memberId, pageId) => {
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id !== memberId) return m
        const pages = m.pages || []
        const hasPage = pages.includes(pageId)
        const next = hasPage ? pages.filter((p) => p !== pageId) : [...pages, pageId]
        return { ...m, pages: next }
      })
    )
  }

  const handleSave = async () => {
    if (!dbMode) return
    setSaveError(null)
    setSaved(true)
    try {
      for (const m of members) {
        await api.users.updatePages(m.id, m.pages || [])
      }
      await fetchMembers()
      onSave?.()
    } catch (err) {
      console.error(err)
      setSaveError(err.message || 'Échec de la sauvegarde')
    } finally {
      setSaved(false)
    }
  }

  const handleAddMember = async () => {
    if (!newMember.name.trim() || !newMember.email.trim()) return
    try {
      await api.users.create({
        name: newMember.name.trim(),
        email: newMember.email.trim(),
        password: newMember.password,
        role: newMember.role,
        pages: newMember.pages || ['spend'],
      })
      setNewMember({ name: '', email: '', password: 'VpTeam2026!', role: 'team', pages: ['spend'] })
      setShowForm(false)
      await fetchMembers()
    } catch (err) {
      console.error(err)
    }
  }

  const handleRemoveMember = async (id) => {
    if (members.length <= 1) return
    try {
      await api.users.delete(id)
      await fetchMembers()
    } catch (err) {
      console.error(err)
    }
  }

  if (!dbMode) {
    return (
      <div className="admin-page">
        <div className="admin-empty-state">
          <p>Connectez-vous avec un compte pour gérer les membres.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-loading">Chargement...</div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      {saveError && (
        <div className="admin-save-error">
          {saveError}
        </div>
      )}
      <header className="admin-header">
        <h2><Users size={24} /> Members</h2>
        <div className="admin-header-actions">
          <button className="add-btn" onClick={() => setShowForm(!showForm)}>
            <Plus size={18} />
            Add member
          </button>
          <button className={`save-btn ${saved ? 'saved' : ''}`} onClick={handleSave} disabled={saved}>
            <Save size={18} />
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </header>

      {showForm && (
        <div className="add-member-form">
          <input
            type="text"
            placeholder="Name"
            value={newMember.name}
            onChange={(e) => setNewMember((p) => ({ ...p, name: e.target.value }))}
          />
          <input
            type="email"
            placeholder="Email"
            value={newMember.email}
            onChange={(e) => setNewMember((p) => ({ ...p, email: e.target.value }))}
          />
          <input
            type="password"
            placeholder="Password"
            value={newMember.password}
            onChange={(e) => setNewMember((p) => ({ ...p, password: e.target.value }))}
          />
          <select
            value={newMember.role}
            onChange={(e) => setNewMember((p) => ({ ...p, role: e.target.value }))}
          >
            <option value="team">Team</option>
            <option value="admin">Admin</option>
          </select>
          <button className="add-submit" onClick={handleAddMember}>Add</button>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              {PAGE_IDS.map((pid) => (
                <th key={pid}>{PAGE_LABELS[pid]}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="member-cell">
                    <User size={18} />
                    <div>
                      <strong>{m.name}</strong>
                      <span className="member-email">{m.email}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`role-badge ${m.role}`}>
                    {m.role === 'admin' ? <Shield size={14} /> : null}
                    {m.role}
                  </span>
                </td>
                {PAGE_IDS.map((pid) => (
                  <td key={pid}>
                    <label className="permission-checkbox">
                      <input
                        type="checkbox"
                        checked={m.role === 'admin' || (m.pages || []).includes(pid)}
                        disabled={m.role === 'admin'}
                        onChange={() => handleTogglePage(m.id, pid)}
                      />
                    </label>
                  </td>
                ))}
                <td>
                  {members.length > 1 && (
                    <button
                      className="remove-btn"
                      onClick={() => handleRemoveMember(m.id)}
                      title="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.length === 0 && (
          <div className="admin-empty-table">Aucun membre.</div>
        )}
      </div>
    </div>
  )
}
