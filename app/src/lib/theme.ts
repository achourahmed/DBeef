import { useEffect, useState } from 'react'

// Appearance prefs: palette (warm | graphite), light/dark/system, table density. Stored per browser.
export type Prefs = { theme: 'warm' | 'graphite'; mode: 'system' | 'light' | 'dark'; density: 'comfortable' | 'compact' }

const KEY = 'dbeef:prefs'
const DEFAULTS: Prefs = { theme: 'warm', mode: 'system', density: 'comfortable' }
const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return DEFAULTS
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // private mode or blocked storage: the choice just won't persist
  }
}

export function applyTheme(p: Prefs, sysDark = systemDark()): boolean {
  const html = document.documentElement
  const dark = p.mode === 'dark' || (p.mode === 'system' && sysDark)
  html.dataset.theme = p.theme
  html.dataset.density = p.density
  html.classList.toggle('dark', dark)
  return dark
}

export function useTheme() {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [sysDark, setSysDark] = useState(systemDark)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSysDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  useEffect(() => {
    applyTheme(prefs, sysDark)
    savePrefs(prefs)
  }, [prefs, sysDark])
  const dark = prefs.mode === 'dark' || (prefs.mode === 'system' && sysDark)
  return { prefs, dark, set: (p: Partial<Prefs>) => setPrefs((old) => ({ ...old, ...p })) }
}
