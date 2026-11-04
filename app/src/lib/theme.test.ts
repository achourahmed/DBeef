import { applyTheme, loadPrefs, savePrefs } from './theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme')
})

test('defaults to warm, comfortable, following the system', () => {
  expect(loadPrefs()).toEqual({ theme: 'warm', mode: 'system', density: 'comfortable' })
})

test('applies theme, density and an explicit dark mode to <html>', () => {
  applyTheme({ theme: 'graphite', mode: 'dark', density: 'compact' }, false)
  const html = document.documentElement
  expect(html.dataset.theme).toBe('graphite')
  expect(html.dataset.density).toBe('compact')
  expect(html.classList.contains('dark')).toBe(true)
  applyTheme({ theme: 'warm', mode: 'system', density: 'comfortable' }, false)
  expect(html.classList.contains('dark')).toBe(false)
  applyTheme({ theme: 'warm', mode: 'system', density: 'comfortable' }, true)
  expect(html.classList.contains('dark')).toBe(true)
})

test('saved prefs survive a reload and bad storage falls back to defaults', () => {
  savePrefs({ theme: 'graphite', mode: 'light', density: 'compact' })
  expect(loadPrefs()).toEqual({ theme: 'graphite', mode: 'light', density: 'compact' })
  localStorage.setItem('dbeef:prefs', '{nope')
  expect(loadPrefs().theme).toBe('warm')
})
