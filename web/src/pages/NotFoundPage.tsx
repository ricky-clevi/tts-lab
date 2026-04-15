import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="not-found-page">
      <div className="not-found-container">
        <span className="not-found-icon">🔍</span>
        <h1 className="not-found-code">404</h1>
        <h2 className="not-found-title">Page Not Found</h2>
        <p className="not-found-description">
          The page you're looking for doesn't exist or you don't have permission to access it.
        </p>
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
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-gray-50);
          padding: var(--space-4);
        }

        .not-found-container {
          text-align: center;
          background: var(--color-white);
          padding: var(--space-12) var(--space-8);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          max-width: 500px;
          width: 100%;
          animation: fade-in-up var(--transition-slow);
        }

        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .not-found-icon {
          font-size: 4rem;
          display: block;
          margin-bottom: var(--space-4);
        }

        .not-found-code {
          font-size: 6rem;
          font-weight: var(--font-bold);
          margin: 0;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          line-height: 1;
        }

        .not-found-title {
          font-size: var(--text-2xl);
          margin: var(--space-4) 0;
          color: var(--color-gray-900);
        }

        .not-found-description {
          color: var(--color-gray-600);
          margin: 0 0 var(--space-8);
          line-height: var(--leading-relaxed);
        }

        .not-found-actions {
          display: flex;
          gap: var(--space-3);
          justify-content: center;
          flex-wrap: wrap;
        }

        @media (max-width: 480px) {
          .not-found-container {
            padding: var(--space-8) var(--space-4);
          }

          .not-found-code {
            font-size: 4rem;
          }

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
