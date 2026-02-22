import { sql, hasDb } from './index.js'

function guard() {
  if (!hasDb()) throw new Error('DATABASE_URL not configured')
}

export async function listWorkspacesForUser(userId) {
  guard()
  const rows = await sql`
    SELECT w.id, w.name, wm.role
    FROM workspace_members wm
    JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = ${String(userId)}
    ORDER BY w.created_at ASC
  `
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role }))
}

export async function createWorkspace({ name, ownerUserId }) {
  guard()
  const wsName = String(name || '').trim()
  if (!wsName) throw new Error('Workspace name required')

  const existing = await listWorkspacesForUser(ownerUserId)
  if (existing.length === 1 && existing[0].name === 'Legacy') {
    await sql`
      UPDATE workspaces SET name = ${wsName}
      WHERE id = ${existing[0].id}
    `
    return { id: existing[0].id, name: wsName, role: existing[0].role || 'owner' }
  }

  const [ws] = await sql`
    INSERT INTO workspaces (name)
    VALUES (${wsName})
    RETURNING id, name
  `
  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${ws.id}, ${String(ownerUserId)}, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `
  return { id: ws.id, name: ws.name, role: 'owner' }
}

export async function ensureDefaultWorkspaceForUser(userId, nameHint = null) {
  guard()
  const existing = await listWorkspacesForUser(userId)
  if (existing.length) return existing[0]

  const wsName = (String(nameHint || '').trim() || 'Default workspace')
  return createWorkspace({ name: wsName, ownerUserId: userId })
}

export async function getWorkspaceRole(workspaceId, userId) {
  guard()
  if (!workspaceId || !userId) return null
  const rows = await sql`
    SELECT role
    FROM workspace_members
    WHERE workspace_id = ${String(workspaceId)}
      AND user_id = ${String(userId)}
    LIMIT 1
  `
  return rows?.[0]?.role || null
}

export async function listWorkspaceMembers(workspaceId) {
  guard()
  const rows = await sql`
    SELECT u.id, u.email, u.name, wm.role
    FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ${String(workspaceId)}
    ORDER BY wm.role = 'owner' DESC, u.name, u.email
  `
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name || '', role: r.role }))
}

export async function addWorkspaceMember(workspaceId, userId, role = 'member') {
  guard()
  const wid = String(workspaceId)
  const uid = String(userId)
  const r = role === 'owner' || role === 'admin' ? role : 'member'
  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${wid}, ${uid}, ${r})
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = ${r}
  `
  return { userId: uid, role: r }
}

export async function removeWorkspaceMember(workspaceId, userId) {
  guard()
  const wid = String(workspaceId)
  const uid = String(userId)
  const owners = await sql`
    SELECT user_id FROM workspace_members
    WHERE workspace_id = ${wid} AND role = 'owner'
  `
  if (owners.length === 1 && String(owners[0].user_id) === uid) {
    throw new Error('Cannot remove the last owner of the workspace')
  }
  await sql`
    DELETE FROM workspace_members
    WHERE workspace_id = ${wid} AND user_id = ${uid}
  `
  return { removed: true }
}

