import React, { useEffect, useMemo, useState } from 'react'
import { createUser, deleteUser, fetchUsers } from '../api'
import '../styles/pages/studio.css'
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmModal, Input, Select, SkeletonTable, useToast } from '../components/ui'
import { t } from '../i18n'
import { createSecurePassword } from '../lib/clientIds'
import { formatAppDate } from '../lib/formatters'
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
      setError(err instanceof Error ? err.message : t('studio.error.loadUsers'))
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
    setPassword(createSecurePassword())
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      showError(t('studio.error.missingCredentials'))
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
      success(t('studio.toast.created', { username: result.user.username }))
    } catch (err) {
      showError(err instanceof Error ? err.message : t('studio.error.createUser'))
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
      success(t('studio.toast.deleted', { username: userToDelete.username }))
      setDeleteModalOpen(false)
      setUserToDelete(null)
    } catch (err) {
      showError(err instanceof Error ? err.message : t('studio.error.deleteUser'))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCopyCredentials = () => {
    if (!generatedCredentials) return
    navigator.clipboard.writeText(`${t('studio.credentials.username')}: ${generatedCredentials.username}\n${t('studio.credentials.password')}: ${generatedCredentials.password}`)
    success(t('studio.toast.copiedCredentials'))
  }

  const adminCount = users.filter((user) => user.role === 'admin').length
  const userCount = users.filter((user) => user.role === 'user').length

  return (
    <div className="page studio-page">
      <div className="page-container">
        <div className="page-header">
          <p className="studio-kicker">{t('studio.kicker')}</p>
          <h1>{t('studio.title')}</h1>
          <p className="page-description">{t('studio.description')}</p>
        </div>

        {error && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}

        <div className="studio-layout">
          <Card className="create-user-card">
            <CardHeader>
              <div>
                <p className="studio-section-kicker">{t('studio.provision.kicker')}</p>
                <h2>{t('studio.provision.title')}</h2>
              </div>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreateUser} className="create-form">
                <Input label={t('login.username')} value={username} onChange={(e) => setUsername(e.target.value)} disabled={isCreating} required placeholder={t('studio.form.usernamePlaceholder')} />
                <div className="password-field">
                  <Input label={t('login.password')} type="text" value={password} onChange={(e) => setPassword(e.target.value)} disabled={isCreating} required placeholder={t('studio.form.passwordPlaceholder')} />
                  <Button type="button" variant="secondary" size="sm" onClick={generatePassword} disabled={isCreating} className="generate-btn">
                    {t('studio.form.generate')}
                  </Button>
                </div>
                <Select label={t('studio.form.role')} value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'user')} disabled={isCreating} options={[{ value: 'user', label: t('studio.role.user') }, { value: 'admin', label: t('studio.role.admin') }]} />
                <Button type="submit" variant="primary" fullWidth isLoading={isCreating}>
                  {isCreating ? t('studio.form.creating') : t('studio.form.create')}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card className="users-card">
            <CardHeader>
              <div className="users-header">
                <div>
                  <p className="studio-section-kicker">{t('studio.users.kicker')}</p>
                  <h2>{t('studio.users.title', { count: users.length })}</h2>
                </div>
                <div className="user-stats">
                  <Badge variant="admin">{t('studio.users.adminCount', { count: adminCount })}</Badge>
                  <Badge variant="user">{t('studio.users.userCount', { count: userCount })}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              <div className="users-toolbar">
                <Input placeholder={t('studio.users.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} leftIcon="ID" />
              </div>

              {loading ? (
                <SkeletonTable rows={5} columns={4} />
              ) : filteredUsers.length === 0 ? (
                <div className="empty-users">
                  <p>{users.length === 0 ? t('studio.users.empty') : t('studio.users.noMatch', { query: searchQuery })}</p>
                </div>
              ) : (
                <div className="users-table-container">
                  <table className="table users-table">
                    <thead>
                      <tr>
                        <th>{t('studio.table.username')}</th>
                        <th>{t('studio.table.role')}</th>
                        <th>{t('studio.table.created')}</th>
                        <th>{t('studio.table.status')}</th>
                        <th>{t('studio.table.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((user) => (
                        <tr key={user.id}>
                          <td><span className="user-name">{user.username}</span></td>
                          <td><Badge variant={user.role === 'admin' ? 'admin' : 'user'}>{user.role === 'admin' ? t('studio.role.admin') : t('studio.role.user')}</Badge></td>
                          <td className="date-cell">{formatAppDate(user.created_at)}</td>
                          <td><Badge variant={user.is_active ? 'success' : 'error'}>{user.is_active ? t('studio.status.active') : t('studio.status.inactive')}</Badge></td>
                          <td>
                            <Button variant="danger" size="sm" onClick={() => { setUserToDelete(user); setDeleteModalOpen(true) }} disabled={user.role === 'admin' && adminCount <= 1}>
                              {t('studio.delete.action')}
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
                <h2 className="modal-title">{t('studio.credentials.title')}</h2>
              </div>
              <div className="modal-body">
                <Alert variant="success">{t('studio.credentials.description')}</Alert>
                <div className="credentials-box">
                  <div className="credential-row">
                    <span className="credential-label">{t('studio.credentials.username')}</span>
                    <code className="credential-value">{generatedCredentials.username}</code>
                  </div>
                  <div className="credential-row">
                    <span className="credential-label">{t('studio.credentials.password')}</span>
                    <code className="credential-value">{generatedCredentials.password}</code>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <Button variant="secondary" onClick={handleCopyCredentials}>{t('studio.credentials.copy')}</Button>
                <Button variant="primary" onClick={() => setShowCredentials(false)}>{t('studio.credentials.done')}</Button>
              </div>
            </div>
          </div>
        )}

        <ConfirmModal
          isOpen={deleteModalOpen}
          onClose={() => { setDeleteModalOpen(false); setUserToDelete(null) }}
          onConfirm={handleDeleteConfirm}
          title={t('studio.delete.title')}
          message={t('studio.delete.message', { username: userToDelete?.username ?? '' })}
          confirmText={t('studio.delete.confirm')}
          cancelText={t('modal.cancel')}
          variant="danger"
          isLoading={isDeleting}
        />
      </div>
    </div>
  )
}
