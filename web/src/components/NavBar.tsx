import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import '../styles/components/navbar.css'
import { useAuth } from '../auth/useAuth'
import { getCurrentLocale, setLocale, t } from '../i18n'

const NAV_ITEMS = [
  { to: '/tts', label: 'TTS', metaKey: 'nav.meta.tts' },
  { to: '/voices', label: 'Voices', metaKey: 'nav.meta.voices' },
  { to: '/chat', label: 'Chat', metaKey: 'nav.meta.chat' },
]

export default function NavBar() {
  const navigate = useNavigate()
  const { user, logout, isAdmin } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const toggleLocale = () => {
    const newLocale = getCurrentLocale() === 'en' ? 'ko' : 'en'
    setLocale(newLocale)
    window.location.reload()
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const navLinkClass = ({ isActive }: { isActive: boolean }) => `nav-link ${isActive ? 'nav-link-active' : ''}`

  return (
    <nav className="navbar" role="navigation" aria-label={t('nav.mainNavigation')}>
      <div className="navbar-container">
        <Link to="/" className="brand-lockup">
          <span className="brand-mark">VL</span>
          <span className="brand-copy">
            <strong>{t('brand.title')}</strong>
            <span>{t('brand.subtitle')}</span>
          </span>
        </Link>

        <button
          className="mobile-menu-btn"
          onClick={() => setShowMobileMenu((value) => !value)}
          aria-expanded={showMobileMenu}
          aria-label={t('nav.toggleMenu')}
        >
          {t('nav.menu')}
        </button>

        <div className={`navbar-links ${showMobileMenu ? 'navbar-links-open' : ''}`}>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={() => setShowMobileMenu(false)}>
              <span className="nav-link-title">{t(`nav.${item.label.toLowerCase()}`) || item.label}</span>
              <span className="nav-link-meta">{t(item.metaKey)}</span>
            </NavLink>
          ))}
        </div>

        <div className="navbar-right">
          <button
            onClick={toggleLocale}
            className="locale-toggle"
            title={t('languageSwitcher.toggle')}
            aria-label={t('languageSwitcher.switchTo', { language: getCurrentLocale() === 'en' ? t('languageSwitcher.korean') : t('languageSwitcher.english') })}
          >
            <span>{getCurrentLocale() === 'en' ? 'KO' : 'EN'}</span>
          </button>

          <div className="user-menu" ref={dropdownRef}>
            <button
              onClick={() => setShowUserMenu((value) => !value)}
              className="user-button"
              aria-expanded={showUserMenu}
              aria-haspopup="true"
              title={user?.username}
            >
              <span className="user-avatar">{user?.username?.slice(0, 2).toUpperCase()}</span>
              <span className="user-meta">
                <strong>{user?.username}</strong>
                <span>{isAdmin ? t('nav.workspace.admin') : t('nav.workspace.operator')}</span>
              </span>
            </button>

            {showUserMenu && (
              <div className="dropdown-menu" role="menu">
                <div className="dropdown-header">
                  <span className="dropdown-user-name">{user?.username}</span>
                  <span className="dropdown-user-role">{user?.role}</span>
                </div>
                {isAdmin && (
                  <Link to="/studio" className="dropdown-item" role="menuitem" onClick={() => setShowUserMenu(false)}>
                    {t('nav.adminStudio')}
                  </Link>
                )}
                <button onClick={handleLogout} className="dropdown-item dropdown-item-danger" role="menuitem">
                  {t('nav.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
