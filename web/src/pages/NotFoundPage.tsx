import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'
import { t } from '../i18n'
import '../styles/pages/not-found.css'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="not-found-page">
      <div className="not-found-container">
        <span className="not-found-mark">404</span>
        <div className="not-found-copy">
          <p className="not-found-kicker">{t('notFound.kicker')}</p>
          <h1 className="not-found-title">{t('notFound.title')}</h1>
          <p className="not-found-description">{t('notFound.description')}</p>
        </div>
        <div className="not-found-actions">
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('notFound.goDashboard')}
          </Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            {t('notFound.goBack')}
          </Button>
        </div>
      </div>
    </div>
  )
}
