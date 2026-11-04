import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, loadPrefs } from './lib/theme'

// Apply the saved palette before the first paint; useTheme keeps it in sync afterwards.
applyTheme(loadPrefs())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
