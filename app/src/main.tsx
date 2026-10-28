import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Follow the system theme; shadcn's dark styles key off the .dark class.
const dark = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches)
applyTheme()
dark.addEventListener('change', applyTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
