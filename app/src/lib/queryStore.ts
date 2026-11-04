// Query history and saved queries, kept in this browser only (localStorage), one bucket per project+store.

export type HistoryEntry = { text: string; at: number; rows: number | null; error: string | null }
export type SavedQuery = { name: string; text: string }
export type Store = { history: HistoryEntry[]; saved: SavedQuery[] }

const MAX_HISTORY = 50
const key = (project: string, store: string) => `dbeef:${project}:${store}`

export function load(project: string, store: string): Store {
  try {
    const raw = localStorage.getItem(key(project, store))
    const parsed = raw ? (JSON.parse(raw) as Partial<Store>) : {}
    return { history: parsed.history ?? [], saved: parsed.saved ?? [] }
  } catch {
    return { history: [], saved: [] }
  }
}

function write(project: string, store: string, data: Store) {
  localStorage.setItem(key(project, store), JSON.stringify(data))
}

export function addHistory(project: string, store: string, entry: Omit<HistoryEntry, 'at'>) {
  const data = load(project, store)
  const history = data.history[0]?.text === entry.text ? data.history.slice(1) : data.history
  write(project, store, { ...data, history: [{ ...entry, at: Date.now() }, ...history].slice(0, MAX_HISTORY) })
}

export function saveQuery(project: string, store: string, name: string, text: string) {
  const data = load(project, store)
  write(project, store, { ...data, saved: [...data.saved.filter((s) => s.name !== name), { name, text }] })
}

export function renameSaved(project: string, store: string, from: string, to: string) {
  const data = load(project, store)
  write(project, store, { ...data, saved: data.saved.map((s) => (s.name === from ? { ...s, name: to } : s)) })
}

export function removeSaved(project: string, store: string, name: string) {
  const data = load(project, store)
  write(project, store, { ...data, saved: data.saved.filter((s) => s.name !== name) })
}

export function exportStore(project: string, store: string): string {
  return JSON.stringify(load(project, store), null, 2)
}

export function importStore(project: string, store: string, json: string) {
  const parsed = JSON.parse(json) as Partial<Store>
  if (!Array.isArray(parsed.saved) && !Array.isArray(parsed.history)) throw new Error('not a DBeef query export')
  const data = load(project, store)
  const names = new Set((parsed.saved ?? []).map((s) => s.name))
  write(project, store, {
    saved: [...data.saved.filter((s) => !names.has(s.name)), ...(parsed.saved ?? [])],
    history: [...(parsed.history ?? []), ...data.history].slice(0, MAX_HISTORY),
  })
}
