import React, { useEffect, useMemo, useState } from 'react'
import { createUser, deleteUser, fetchUsers } from '../api'
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmModal, Input, Select, SkeletonTable } from '../components/ui'
import { useToast } from '../components/ui/Toast'
import type { UserResponse } from '../types'

export default function StudioPage() {
  const { success, error: showError } = useToast()
  const [users, setUsers] = useState<UserResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [isCreating, setIsCreating] = useState(false)
  const [showCredentials, setShowCredentials] = useState(false)
  const [generatedCredentials, setGeneratedCredentials] = useState<{ username: string; password: string } | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<UserResponse | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      setLoading(true)
      setError('')
      setUsers(await fetchUsers())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users
    const query = searchQuery.toLowerCase()
    return users.filter((user) => user.username.toLowerCase().includes(query) || user.role.toLowerCase().includes(query))
  }, [users, searchQuery])

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
    let result = ''
    for (let index = 0; index < 16; index += 1) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setPassword(result)
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      showError('Username and password are required')
      return
    }

    try {
      setIsCreating(true)
      const result = await createUser(username, password, role)
      setUsers((prev) => [result.user, ...prev])
      setGeneratedCredentials({ username: result.user.username, password: result.password })
      setShowCredentials(true)
      setUsername('')
      setPassword('')
      setRole('user')
      success(`User "${result.user.username}" created successfully`)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!userToDelete) return

    try {
      setIsDeleting(true)
      await deleteUser(userToDelete.id)
      setUsers((prev) => prev.filter((user) => user.id !== userToDelete.id))
      success(`User "${userToDelete.username}" deleted`)
      setDeleteModalOpen(false)
      setUserToDelete(null)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCopyCredentials = () => {
    if (!generatedCredentials) return
    navigator.clipboard.writeText(`Username: ${generatedCredentials.username}\nPassword: ${generatedCredentials.password}`)
    success('Credentials copied to clipboard')
  }

  const adminCount = users.filter((user) => user.role === 'admin').length
  const userCount = users.filter((user) => user.role === 'user').length

  return (
    <div className="page studio-page">
      <div className="page-container">
        <div className="page-header">
          <p className="studio-kicker">Admin Controls</p>
          <h1>Admin Studio</h1>
          <p className="page-description">Manage workspace access and keep operator accounts ready for voice-production workflows.</p>
        </div>

        {error && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}

        <div className="studio-layout">
          <Card className="create-user-card">
            <CardHeader>
              <div>
                <p className="studio-section-kicker">Provision Access</p>
                <h2>Create New User</h2>
              </div>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreateUser} className="create-form">
                <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={isCreating} required placeholder="Enter username" />
                <div className="password-field">
                  <Input label="Password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} disabled={isCreating} required placeholder="Enter or generate password" />
                  <Button type="button" variant="secondary" size="sm" onClick={generatePassword} disabled={isCreating} className="generate-btn">
                    Generate
                  </Button>
                </div>
                <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'user')} disabled={isCreating} options={[{ value: 'user', label: 'User' }, { value: 'admin', label: 'Admin' }]} />
                <Button type="submit" variant="primary" fullWidth isLoading={isCreating}>
                  {isCreating ? 'Creating...' : 'Create User'}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card className="users-card">
            <CardHeader>
              <div className="users-header">
                <div>
                  <p className="studio-section-kicker">Workspace Access</p>
                  <h2>Users ({users.length})</h2>
                </div>
                <div className="user-stats">
                  <Badge variant="admin">{adminCount} Admins</Badge>
                  <Badge variant="user">{userCount} Users</Badge>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              <div className="users-toolbar">
                <Input placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} leftIcon="ID" />
              </div>

              {loading ? (
                <SkeletonTable rows={5} columns={4} />
              ) : filteredUsers.length === 0 ? (
                <div className="empty-users">
                  <p>{users.length === 0 ? 'No users found' : `No users match "${searchQuery}"`}</p>
                </div>
              ) : (
                <div className="users-table-container">
                  <table className="table users-table">
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Role</th>
                        <th>Created</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((user) => (
                        <tr key={user.id}>
                          <td><span className="user-name">{user.username}</span></td>
                          <td><Badge variant={user.role === 'admin' ? 'admin' : 'user'}>{user.role}</Badge></td>
                          <td className="date-cell">{new Date(user.created_at).toLocaleDateString()}</td>
                          <td><Badge variant={user.is_active ? 'success' : 'error'}>{user.is_active ? 'Active' : 'Inactive'}</Badge></td>
                          <td>
                            <Button variant="danger" size="sm" onClick={() => { setUserToDelete(user); setDeleteModalOpen(true) }} disabled={user.role === 'admin' && adminCount <= 1}>
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {showCredentials && generatedCredentials && (
          <div className="modal-backdrop" onClick={() => setShowCredentials(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">User Created Successfully</h2>
              </div>
              <div className="modal-body">
                <Alert variant="success">Save these credentials now. The password will not be shown again.</Alert>
                <div className="credentials-box">
                  <div className="credential-row">
                    <span className="credential-label">Username</span>
                    <code className="credential-value">{generatedCredentials.username}</code>
                  </div>
                  <div className="credential-row">
                    <span className="credential-label">Password</span>
                    <code className="credential-value">{generatedCredentials.password}</code>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <Button variant="secondary" onClick={handleCopyCredentials}>Copy Credentials</Button>
                <Button variant="primary" onClick={() => setShowCredentials(false)}>Done</Button>
              </div>
            </div>
          </div>
        )}

        <ConfirmModal
          isOpen={deleteModalOpen}
          onClose={() => { setDeleteModalOpen(false); setUserToDelete(null) }}
          onConfirm={handleDeleteConfirm}
          title="Delete User"
          message={`Are you sure you want to delete user "${userToDelete?.username}"? This will also delete all their voice profiles.`}
          confirmText="Delete User"
          cancelText="Cancel"
          variant="danger"
          isLoading={isDeleting}
        />
      </div>

      <style>{`
        .studio-kicker, .studio-section-kicker {
          color: var(--color-primary-700);
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.16em;
          text-transform: uppercase;
          margin-bottom: var(--space-2);
        }
        .studio-page .page-container { max-width: 1200px; }
        .studio-layout { display: grid; grid-template-columns: 350px 1fr; gap: var(--space-6); align-items: start; }
        .create-form { display: flex; flex-direction: column; gap: var(--space-4); }
        .password-field { display: flex; gap: var(--space-2); align-items: flex-end; }
        .password-field .form-group { flex: 1; }
        .generate-btn { margin-bottom: 2px; white-space: nowrap; }
        .users-header { display: flex; justify-content: space-between; align-items: center; width: 100%; }
        .user-stats { display: flex; gap: var(--space-2); }
        .users-toolbar { margin-bottom: var(--space-4); }
        .users-table-container { overflow-x: auto; }
        .users-table { min-width: 600px; }
        .user-name { font-weight: var(--font-medium); }
        .date-cell { color: var(--color-gray-500); font-size: var(--text-sm); }
        .empty-users { text-align: center; padding: var(--space-8); color: var(--color-gray-500); }
        .credentials-box {
          margin-top: var(--space-4);
          padding: var(--space-4);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          border-radius: var(--radius-md);
        }
        .credential-row { display: flex; gap: var(--space-4); padding: var(--space-2) 0; }
        .credential-row:first-child { border-bottom: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%); }
        .credential-label { font-weight: var(--font-semibold); color: var(--color-gray-600); min-width: 80px; }
        .credential-value { background: var(--color-white); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); word-break: break-all; }
        @media (max-width: 1024px) {
          .studio-layout { grid-template-columns: 1fr; }
          .create-user-card { order: 2; }
          .users-card { order: 1; }
        }
        @media (max-width: 640px) {
          .users-header, .password-field { flex-direction: column; align-items: stretch; }
          .generate-btn { width: 100%; }
        }
      `}</style>
    </div>
  )
}
