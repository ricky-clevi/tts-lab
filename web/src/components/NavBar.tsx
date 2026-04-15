import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { getCurrentLocale, setLocale, t } from '../i18n'

const NAV_ITEMS = [
  { to: '/tts', label: 'TTS', shortLabel: 'Synthesis' },
  { to: '/voices', label: 'Voices', shortLabel: 'Library' },
  { to: '/chat', label: 'Chat', shortLabel: 'Realtime' },
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
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="navbar-container">
        <Link to="/" className="brand-lockup">
          <span className="brand-mark">VL</span>
          <span className="brand-copy">
            <strong>TTS Lab</strong>
            <span>Voice operations workspace</span>
          </span>
        </Link>

        <button
          className="mobile-menu-btn"
          onClick={() => setShowMobileMenu((value) => !value)}
          aria-expanded={showMobileMenu}
          aria-label="Toggle navigation menu"
        >
          Menu
        </button>

        <div className={`navbar-links ${showMobileMenu ? 'navbar-links-open' : ''}`}>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={() => setShowMobileMenu(false)}>
              <span className="nav-link-title">{t(`nav.${item.label.toLowerCase()}`) || item.label}</span>
              <span className="nav-link-meta">{item.shortLabel}</span>
            </NavLink>
          ))}
        </div>

        <div className="navbar-right">
          <button
            onClick={toggleLocale}
            className="locale-toggle"
            title="Toggle language"
            aria-label={`Switch to ${getCurrentLocale() === 'en' ? 'Korean' : 'English'}`}
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
                <span>{isAdmin ? 'Admin workspace' : 'Operator workspace'}</span>
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
                    Admin Studio
                  </Link>
                )}
                <button onClick={handleLogout} className="dropdown-item dropdown-item-danger" role="menuitem">
                  {t('nav.logout') || 'Logout'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .navbar {
          position: sticky;
          top: 0;
          z-index: var(--z-sticky);
          padding: var(--space-4) var(--space-4) 0;
          background: linear-gradient(180deg, color-mix(in oklab, var(--color-paper) 94%, white 6%), transparent);
          backdrop-filter: blur(12px);
        }

        .navbar-container {
          max-width: var(--container-max-width);
          min-height: var(--navbar-height);
          margin: 0 auto;
          padding: var(--space-3);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-4);
          border: 1px solid color-mix(in oklab, var(--color-line) 78%, white 22%);
          border-radius: var(--radius-2xl);
          background: color-mix(in oklab, var(--color-surface-elevated) 86%, white 14%);
          box-shadow: var(--shadow-md);
        }

        .brand-lockup {
          display: inline-flex;
          align-items: center;
          gap: var(--space-3);
          min-width: 0;
        }

        .brand-mark {
          width: 3rem;
          height: 3rem;
          display: grid;
          place-items: center;
          border-radius: 1rem;
          background: var(--gradient-primary);
          color: var(--color-white);
          font-family: var(--font-family-display);
          font-weight: var(--font-extrabold);
          letter-spacing: 0.08em;
          box-shadow: 0 14px 30px color-mix(in oklab, var(--color-primary-800) 18%, transparent);
        }

        .brand-copy {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .brand-copy strong {
          color: var(--color-gray-900);
          font-family: var(--font-family-display);
          font-size: 1.02rem;
          letter-spacing: -0.02em;
        }

        .brand-copy span {
          color: var(--color-gray-500);
          font-size: var(--text-xs);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .navbar-links {
          display: flex;
          gap: var(--space-2);
          padding: 0.35rem;
          border-radius: var(--radius-full);
          background: color-mix(in oklab, var(--color-surface) 72%, white 28%);
          border: 1px solid color-mix(in oklab, var(--color-line) 72%, white 28%);
          flex: 1;
          max-width: 34rem;
        }

        .nav-link {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
          padding: 0.8rem 1rem;
          border-radius: var(--radius-full);
          color: var(--color-gray-600);
          transition: background-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast);
        }

        .nav-link:hover {
          color: var(--color-gray-900);
          background: color-mix(in oklab, var(--color-primary-50) 38%, transparent);
        }

        .nav-link-active {
          color: var(--color-primary-800);
          background: color-mix(in oklab, var(--color-white) 74%, var(--color-primary-50) 26%);
          box-shadow: var(--shadow-sm);
        }

        .nav-link-title {
          font-size: var(--text-sm);
          font-weight: var(--font-bold);
        }

        .nav-link-meta {
          font-size: 0.68rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-gray-500);
        }

        .navbar-right {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          flex-shrink: 0;
        }

        .locale-toggle {
          min-width: 3rem;
          min-height: 3rem;
          display: grid;
          place-items: center;
          border-radius: var(--radius-full);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
          background: color-mix(in oklab, var(--color-surface) 84%, white 16%);
          color: var(--color-gray-700);
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .user-menu {
          position: relative;
        }

        .user-button {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: 0.45rem var(--space-3) 0.45rem 0.45rem;
          background: color-mix(in oklab, var(--color-surface) 76%, white 24%);
          color: var(--color-gray-800);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
          border-radius: var(--radius-full);
        }

        .user-avatar {
          width: 2.4rem;
          height: 2.4rem;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: var(--gradient-primary);
          color: var(--color-white);
          font-size: 0.72rem;
          font-weight: var(--font-extrabold);
          letter-spacing: 0.08em;
        }

        .user-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          min-width: 0;
        }

        .user-meta strong {
          max-width: 10rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: var(--text-sm);
        }

        .user-meta span {
          font-size: 0.68rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-gray-500);
        }

        .dropdown-header {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          padding: var(--space-4);
          border-bottom: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
          background: color-mix(in oklab, var(--color-surface) 80%, white 20%);
        }

        .dropdown-user-name {
          font-weight: var(--font-bold);
          color: var(--color-gray-900);
        }

        .dropdown-user-role {
          font-size: 0.72rem;
          color: var(--color-gray-500);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .mobile-menu-btn {
          display: none;
          min-height: 2.8rem;
          padding: 0.65rem 1rem;
          border-radius: var(--radius-full);
          border: 1px solid color-mix(in oklab, var(--color-line) 76%, white 24%);
          background: color-mix(in oklab, var(--color-surface) 82%, white 18%);
          color: var(--color-gray-800);
          font-size: var(--text-sm);
          font-weight: var(--font-bold);
        }

        @media (max-width: 960px) {
          .navbar-container {
            flex-wrap: wrap;
          }

          .mobile-menu-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            order: 2;
            margin-left: auto;
          }

          .navbar-links {
            display: none;
            order: 4;
            width: 100%;
            max-width: none;
            flex-direction: column;
            border-radius: var(--radius-xl);
          }

          .navbar-links-open {
            display: flex;
          }

          .nav-link {
            border-radius: var(--radius-lg);
          }

          .navbar-right {
            order: 3;
            width: 100%;
            justify-content: space-between;
          }
        }

        @media (max-width: 640px) {
          .navbar {
            padding: var(--space-3) var(--space-3) 0;
          }

          .brand-copy span,
          .user-meta span {
            display: none;
          }

          .user-meta strong {
            max-width: 7rem;
          }
        }
      `}</style>
    </nav>
  )
}
