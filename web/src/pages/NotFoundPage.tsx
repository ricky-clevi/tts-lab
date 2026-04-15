import React from 'react'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="not-found-page">
      <div className="not-found-container">
        <h1>404</h1>
        <h2>Page Not Found</h2>
        <p>The page you're looking for doesn't exist or you don't have permission to access it.</p>
        <Link to="/" className="home-link">
          Back to Home
        </Link>
      </div>

      <style>{`
        .not-found-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f5f5f5;
        }

        .not-found-container {
          text-align: center;
          background: white;
          padding: 3rem 2rem;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          max-width: 500px;
        }

        .not-found-container h1 {
          font-size: 5rem;
          margin: 0 0 1rem;
          color: #667eea;
          font-weight: 700;
        }

        .not-found-container h2 {
          font-size: 2rem;
          margin: 0 0 1rem;
          color: #333;
        }

        .not-found-container p {
          color: #666;
          margin: 0 0 2rem;
          font-size: 1rem;
          line-height: 1.5;
        }

        .home-link {
          display: inline-block;
          padding: 0.75rem 1.5rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-decoration: none;
          border-radius: 4px;
          font-weight: 600;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .home-link:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
        }
      `}</style>
    </div>
  )
}
