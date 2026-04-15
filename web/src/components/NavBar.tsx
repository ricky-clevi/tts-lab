import { useState, useRef, useEffect } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { t, getCurrentLocale, setLocale } from '../i18n'

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
    // Force re-render
    window.location.reload()
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link ${isActive ? 'nav-link-active' : ''}`

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="navbar-container">
        {/* Brand */}
        <div className="navbar-brand">
          <Link to="/" className="logo">
            <span className="logo-icon">🎙️</span>
            <span className="logo-text">TTS Lab</span>
          </Link>
        </div>

        {/* Mobile menu button */}
        <button
          className="mobile-menu-btn"
          onClick={() => setShowMobileMenu(!showMobileMenu)}
          aria-expanded={showMobileMenu}
          aria-label="Toggle navigation menu"
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>

        {/* Navigation Links */}
        <div className={`navbar-links ${showMobileMenu ? 'navbar-links-open' : ''}`}>
          <NavLink to="/tts" className={navLinkClass} onClick={() => setShowMobileMenu(false)}>
            <span className="nav-icon">🎤</span>
            {t('nav.tts') || 'TTS'}
          </NavLink>
          <NavLink to="/voices" className={navLinkClass} onClick={() => setShowMobileMenu(false)}>
            <span className="nav-icon">🎵</span>
            {t('nav.voices') || 'Voices'}
          </NavLink>
          <NavLink to="/chat" className={navLinkClass} onClick={() => setShowMobileMenu(false)}>
            <span className="nav-icon">💬</span>
            {t('nav.chat') || 'Chat'}
          </NavLink>
        </div>

        {/* Right side */}
        <div className="navbar-right">
          <button
            onClick={toggleLocale}
            className="locale-toggle"
            title="Toggle language"
            aria-label={`Switch to ${getCurrentLocale() === 'en' ? 'Korean' : 'English'}`}
          >
            {getCurrentLocale() === 'en' ? '한국어' : 'English'}
          </button>

          <div className="user-menu" ref={dropdownRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="user-button"
              aria-expanded={showUserMenu}
              aria-haspopup="true"
              title={user?.username}
            >
              <span className="user-avatar">
                {user?.username?.charAt(0).toUpperCase()}
              </span>
              <span className="user-name">{user?.username}</span>
              {isAdmin && <span className="admin-badge">Admin</span>}
              <span className="dropdown-arrow">▾</span>
            </button>

            {showUserMenu && (
              <div className="dropdown-menu" role="menu">
                <div className="dropdown-header">
                  <span className="dropdown-user-name">{user?.username}</span>
                  <span className="dropdown-user-role">{user?.role}</span>
                </div>
                {isAdmin && (
                  <Link
                    to="/studio"
                    className="dropdown-item"
                    role="menuitem"
                    onClick={() => setShowUserMenu(false)}
                  >
                    <span className="dropdown-icon">⚙️</span>
                    Admin Studio
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="dropdown-item dropdown-item-danger"
                  role="menuitem"
                >
                  <span className="dropdown-icon">🚪</span>
                  {t('nav.logout') || 'Logout'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .navbar {
          background: var(--color-white);
          border-bottom: 1px solid var(--border-color);
          position: sticky;
          top: 0;
          z-index: var(--z-sticky);
          box-shadow: var(--shadow-sm);
        }

        .navbar-container {
          max-width: var(--container-max-width);
          margin: 0 auto;
          padding: 0 var(--space-4);
          height: var(--navbar-height);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-6);
        }

        .navbar-brand {
          flex-shrink: 0;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-xl);
          font-weight: var(--font-bold);
          color: var(--color-primary-600);
          text-decoration: none;
          transition: color var(--transition-fast);
        }

        .logo:hover {
          color: var(--color-secondary-500);
        }

        .logo-icon {
          font-size: var(--text-2xl);
        }

        .navbar-links {
          display: flex;
          gap: var(--space-2);
          flex: 1;
          justify-content: center;
        }

        .nav-link {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-4);
          color: var(--color-gray-600);
          text-decoration: none;
          font-weight: var(--font-medium);
          border-radius: var(--radius-md);
          transition: all var(--transition-fast);
        }

        .nav-link:hover {
          color: var(--color-primary-600);
          background: var(--color-primary-50);
        }

        .nav-link-active {
          color: var(--color-primary-600);
          background: var(--color-primary-50);
        }

        .nav-icon {
          font-size: var(--text-lg);
        }

        .navbar-right {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          flex-shrink: 0;
        }

        .locale-toggle {
          padding: var(--space-2) var(--space-3);
          background: var(--color-gray-100);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          font-weight: var(--font-medium);
          color: var(--color-gray-700);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .locale-toggle:hover {
          background: var(--color-gray-200);
          border-color: var(--color-gray-300);
        }

        .user-menu {
          position: relative;
        }

        .user-button {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: var(--gradient-primary);
          color: var(--color-white);
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          font-weight: var(--font-medium);
          font-size: var(--text-sm);
          transition: all var(--transition-fast);
        }

        .user-button:hover {
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .user-avatar {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.2);
          border-radius: var(--radius-full);
          font-weight: var(--font-bold);
          font-size: var(--text-sm);
        }

        .user-name {
          max-width: 100px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .admin-badge {
          font-size: var(--text-xs);
          background: rgba(255, 255, 255, 0.2);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
        }

        .dropdown-arrow {
          font-size: var(--text-xs);
          opacity: 0.8;
        }

        .dropdown-menu {
          position: absolute;
          top: calc(100% + var(--space-2));
          right: 0;
          min-width: 200px;
          background: var(--color-white);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          overflow: hidden;
          animation: dropdown-fade-in var(--transition-fast);
        }

        @keyframes dropdown-fade-in {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .dropdown-header {
          padding: var(--space-3) var(--space-4);
          background: var(--color-gray-50);
          border-bottom: 1px solid var(--border-color);
        }

        .dropdown-user-name {
          display: block;
          font-weight: var(--font-semibold);
          color: var(--color-gray-900);
        }

        .dropdown-user-role {
          display: block;
          font-size: var(--text-xs);
          color: var(--color-gray-500);
          text-transform: capitalize;
        }

        .dropdown-item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          width: 100%;
          padding: var(--space-3) var(--space-4);
          background: none;
          border: none;
          color: var(--color-gray-700);
          font-size: var(--text-sm);
          text-align: left;
          text-decoration: none;
          cursor: pointer;
          transition: background var(--transition-fast);
        }

        .dropdown-item:hover {
          background: var(--color-gray-100);
          color: var(--color-primary-600);
        }

        .dropdown-item-danger {
          color: var(--color-error-600);
          border-top: 1px solid var(--border-color);
        }

        .dropdown-item-danger:hover {
          background: var(--color-error-50);
          color: var(--color-error-700);
        }

        .dropdown-icon {
          font-size: var(--text-base);
        }

        /* Mobile menu button */
        .mobile-menu-btn {
          display: none;
          flex-direction: column;
          justify-content: center;
          gap: 4px;
          padding: var(--space-2);
          background: none;
          border: none;
          cursor: pointer;
        }

        .hamburger-line {
          width: 24px;
          height: 2px;
          background: var(--color-gray-700);
          border-radius: 2px;
          transition: all var(--transition-fast);
        }

        /* Mobile styles */
        @media (max-width: 768px) {
          .navbar-container {
            padding: 0 var(--space-3);
          }

          .mobile-menu-btn {
            display: flex;
          }

          .navbar-links {
            display: none;
            position: absolute;
            top: var(--navbar-height);
            left: 0;
            right: 0;
            flex-direction: column;
            gap: 0;
            background: var(--color-white);
            border-bottom: 1px solid var(--border-color);
            box-shadow: var(--shadow-lg);
            padding: var(--space-2);
          }

          .navbar-links-open {
            display: flex;
          }

          .nav-link {
            padding: var(--space-3) var(--space-4);
            border-radius: var(--radius-md);
          }

          .locale-toggle {
            display: none;
          }

          .user-name {
            display: none;
          }

          .admin-badge {
            display: none;
          }

          .dropdown-arrow {
            display: none;
          }
        }
      `}</style>
    </nav>
  )
}
