import type { QueryResult } from '@/api/client'

const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export function toCSV(r: QueryResult): string {
  const cell = (v: unknown) => {
    const s = text(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [r.columns, ...r.rows].map((row) => row.map(cell).join(',')).join('\r\n')
}

export function toJSON(r: QueryResult): string {
  return JSON.stringify(r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))), null, 2)
}

export function toMarkdown(r: QueryResult): string {
  const cell = (v: unknown) => text(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const line = (row: unknown[]) => `| ${row.map(cell).join(' | ')} |`
  return [line(r.columns), `| ${r.columns.map(() => '---').join(' | ')} |`, ...r.rows.map(line)].join('\n')
}

export function download(name: string, body: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}
