import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './theme'
import { InstanceConfigProvider } from './context/InstanceConfigContext'
import App from './App'
import './i18n' // Initialize i18n before rendering
import './index.css'
import { installSecureFetch } from './utils/secureFetch'

installSecureFetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <InstanceConfigProvider>
        <App />
      </InstanceConfigProvider>
    </ThemeProvider>
  </StrictMode>,
)
