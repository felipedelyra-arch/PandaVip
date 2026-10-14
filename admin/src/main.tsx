import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Último recurso: erro fora das páginas (login, layout) mostra aviso, não tela branca. */}
    <ErrorBoundary>
      <AuthProvider>
        <App />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
