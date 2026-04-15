import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="not-found-page">
      <div className="not-found-container">
        <span className="not-found-mark">404</span>
        <div className="not-found-copy">
          <p className="not-found-kicker">Navigation Error</p>
          <h1 className="not-found-title">This route is not available.</h1>
          <p className="not-found-description">
            The page may have been moved, removed, or blocked by permissions. Return to the main workspace and continue from there.
          </p>
        </div>
        <div className="not-found-actions">
          <Button variant="primary" onClick={() => navigate('/')}>
            Go to Dashboard
          </Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Go Back
          </Button>
        </div>
      </div>

      <style>{`
        .not-found-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: var(--space-4);
          background: var(--gradient-shell);
        }

        .not-found-container {
          width: min(40rem, 100%);
          display: grid;
          gap: var(--space-6);
          padding: clamp(2rem, 5vw, 3.25rem);
          border-radius: var(--radius-2xl);
          border: 1px solid color-mix(in oklab, var(--color-primary-200) 36%, var(--color-line) 64%);
          background:
            radial-gradient(circle at top right, color-mix(in oklab, var(--color-primary-100) 42%, transparent), transparent 36%),
            linear-gradient(180deg, color-mix(in oklab, var(--color-surface-elevated) 94%, white 6%), color-mix(in oklab, var(--color-surface) 88%, var(--color-primary-50) 12%));
          box-shadow: var(--shadow-xl);
        }

        .not-found-mark {
          display: inline-flex;
          width: fit-content;
          padding: 0.55rem 0.9rem;
          border-radius: var(--radius-full);
          background: color-mix(in oklab, var(--color-primary-100) 68%, white 32%);
          color: var(--color-primary-800);
          font-family: var(--font-family-display);
          font-size: var(--text-sm);
          font-weight: var(--font-extrabold);
          letter-spacing: 0.12em;
        }

        .not-found-copy {
          display: grid;
          gap: var(--space-3);
        }

        .not-found-kicker {
          color: var(--color-gray-500);
          font-size: var(--text-xs);
          font-weight: var(--font-bold);
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .not-found-title {
          font-size: clamp(2rem, 5vw, 3rem);
          letter-spacing: -0.05em;
        }

        .not-found-description {
          color: var(--color-gray-600);
          line-height: var(--leading-relaxed);
          max-width: 48ch;
        }

        .not-found-actions {
          display: flex;
          gap: var(--space-3);
          flex-wrap: wrap;
        }

        @media (max-width: 480px) {
          .not-found-actions {
            flex-direction: column;
          }

          .not-found-actions .btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  )
}
