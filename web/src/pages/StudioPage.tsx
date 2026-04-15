import React, { useEffect, useState } from 'react'
import { fetchUsers, createUser, deleteUser } from '../api'
import type { UserResponse } from '../types'

export default function StudioPage() {
  const [users, setUsers] = useState<UserResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [isCreating, setIsCreating] = useState(false)
  const [generatedPassword, setGeneratedPassword] = useState('')
  const [deletingId, setDeletingId] = useState('')

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      setLoading(true)
      setError('')
      const data = await fetchUsers()
      setUsers(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required')
      return
    }

    try {
      setIsCreating(true)
      setError('')
      const result = await createUser(username, password, role)
      setUsers([...users, result.user])
      setGeneratedPassword(result.password)
      setUsername('')
      setPassword('')
      setRole('user')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) {
      return
    }

    try {
      setDeletingId(id)
      await deleteUser(id)
      setUsers(users.filter((u) => u.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setDeletingId('')
    }
  }

  return (
    <div className="studio-page">
      <div className="studio-container">
        <div className="page-header">
          <h1>🎛️ Admin Studio</h1>
          <p>Manage users and system settings</p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="studio-grid">
          {/* Create User Form */}
          <div className="card form-card">
            <h2>Create New User</h2>
            <form onSubmit={handleCreateUser}>
              <div className="form-group">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isCreating}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isCreating}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="role">Role</label>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
                  disabled={isCreating}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <button type="submit" disabled={isCreating} className="submit-button">
                {isCreating ? 'Creating...' : 'Create User'}
              </button>
            </form>

            {generatedPassword && (
              <div className="success-message">
                <p>✓ User created successfully!</p>
                <p className="password-note">
                  <strong>Password:</strong> {generatedPassword}
                </p>
                <p className="password-hint">Make sure to copy this password as it won't be shown again.</p>
                <button onClick={() => setGeneratedPassword('')} className="close-button">
                  Close
                </button>
              </div>
            )}
          </div>

          {/* Users List */}
          <div className="card users-card">
            <h2>Users ({users.length})</h2>
            {loading ? (
              <p>Loading users...</p>
            ) : users.length === 0 ? (
              <p className="no-data">No users found</p>
            ) : (
              <div className="users-table">
                <div className="table-header">
                  <div className="col-username">Username</div>
                  <div className="col-role">Role</div>
                  <div className="col-date">Created</div>
                  <div className="col-action">Action</div>
                </div>
                {users.map((user) => (
                  <div key={user.id} className="table-row">
                    <div className="col-username">{user.username}</div>
                    <div className="col-role">
                      <span className={`role-badge role-${user.role}`}>{user.role}</span>
                    </div>
                    <div className="col-date">{new Date(user.created_at).toLocaleDateString()}</div>
                    <div className="col-action">
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        disabled={deletingId === user.id}
                        className="delete-btn"
                        title="Delete user"
                      >
                        {deletingId === user.id ? '...' : '✕'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .studio-page {
          background: #f5f5f5;
          min-height: 100vh;
          padding: 2rem 1rem;
        }

        .studio-container {
          max-width: 1200px;
          margin: 0 auto;
        }

        .page-header {
          background: white;
          padding: 2rem;
          border-radius: 8px;
          margin-bottom: 2rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .page-header h1 {
          margin: 0 0 0.5rem;
          color: #333;
          font-size: 2rem;
        }

        .page-header p {
          margin: 0;
          color: #666;
        }

        .error-banner {
          background: #ffebee;
          color: #d32f2f;
          padding: 1rem;
          border-radius: 4px;
          margin-bottom: 2rem;
          border-left: 4px solid #d32f2f;
        }

        .studio-grid {
          display: grid;
          grid-template-columns: 1fr 1.5fr;
          gap: 2rem;
        }

        .card {
          background: white;
          border-radius: 8px;
          padding: 2rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .card h2 {
          margin: 0 0 1.5rem;
          color: #333;
          font-size: 1.3rem;
          border-bottom: 2px solid #667eea;
          padding-bottom: 0.75rem;
        }

        .form-group {
          margin-bottom: 1rem;
        }

        .form-group label {
          display: block;
          font-weight: 600;
          color: #555;
          margin-bottom: 0.5rem;
          font-size: 0.9rem;
        }

        .form-group input,
        .form-group select {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 0.95rem;
          box-sizing: border-box;
          transition: border-color 0.2s;
        }

        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .submit-button {
          width: 100%;
          padding: 0.75rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .submit-button:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .submit-button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .success-message {
          background: #e8f5e9;
          color: #2e7d32;
          padding: 1rem;
          border-radius: 4px;
          margin-top: 1rem;
          border-left: 4px solid #2e7d32;
        }

        .success-message p {
          margin: 0.5rem 0;
          font-size: 0.95rem;
        }

        .success-message p:first-child {
          font-weight: 600;
          margin-top: 0;
        }

        .password-note {
          font-family: 'Courier New', monospace;
          background: white;
          padding: 0.75rem;
          border-radius: 4px;
          word-break: break-all;
          margin: 0.5rem 0 !important;
        }

        .password-hint {
          font-size: 0.85rem !important;
          font-style: italic;
          opacity: 0.9;
        }

        .close-button {
          margin-top: 1rem;
          padding: 0.5rem 1rem;
          background: transparent;
          color: #2e7d32;
          border: 1px solid #2e7d32;
          border-radius: 4px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }

        .close-button:hover {
          background: rgba(46, 125, 50, 0.1);
        }

        .no-data {
          color: #999;
          text-align: center;
          padding: 2rem 0;
        }

        .users-table {
          display: flex;
          flex-direction: column;
        }

        .table-header {
          display: grid;
          grid-template-columns: 1fr 0.8fr 1fr 0.8fr;
          gap: 1rem;
          padding: 1rem;
          background: #f5f5f5;
          border-radius: 4px;
          font-weight: 600;
          color: #555;
          font-size: 0.9rem;
          border-bottom: 2px solid #ddd;
          margin-bottom: 0.5rem;
        }

        .table-row {
          display: grid;
          grid-template-columns: 1fr 0.8fr 1fr 0.8fr;
          gap: 1rem;
          padding: 1rem;
          border-bottom: 1px solid #eee;
          align-items: center;
          font-size: 0.95rem;
        }

        .table-row:hover {
          background: #f9f9f9;
        }

        .col-username {
          font-weight: 500;
          color: #333;
        }

        .role-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          font-size: 0.85rem;
          font-weight: 600;
        }

        .role-badge.role-admin {
          background: #fff3e0;
          color: #e65100;
        }

        .role-badge.role-user {
          background: #e3f2fd;
          color: #0d47a1;
        }

        .col-date {
          color: #999;
          font-size: 0.9rem;
        }

        .delete-btn {
          padding: 0.4rem 0.6rem;
          background: #ffebee;
          color: #d32f2f;
          border: 1px solid #d32f2f;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          transition: background 0.2s;
          width: 100%;
        }

        .delete-btn:hover:not(:disabled) {
          background: #ffcdd2;
        }

        .delete-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @media (max-width: 1024px) {
          .studio-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .studio-page {
            padding: 1rem;
          }

          .page-header h1 {
            font-size: 1.5rem;
          }

          .card {
            padding: 1.5rem;
          }

          .table-header,
          .table-row {
            grid-template-columns: 1fr;
            gap: 0.5rem;
          }

          .col-username::before {
            content: 'Username: ';
            font-weight: 600;
            color: #555;
          }

          .col-role::before {
            content: 'Role: ';
            font-weight: 600;
            color: #555;
          }

          .col-date::before {
            content: 'Created: ';
            font-weight: 600;
            color: #555;
          }
        }
      `}</style>
    </div>
  )
}
