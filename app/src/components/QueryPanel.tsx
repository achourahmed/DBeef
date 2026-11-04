import { useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, type QueryResult } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import { addHistory } from '@/lib/queryStore'
import { ErrorNote } from './ErrorNote'
import { ExportMenu } from './ExportMenu'
import { QueryLibrary } from './QueryLibrary'
import { ResultTable } from './ResultTable'

const PLACEHOLDER: Record<string, string> = {
  sqlite: 'SELECT * FROM runs LIMIT 10',
  neo4j: 'MATCH (n) RETURN n LIMIT 10',
  redis: 'SCAN 0 MATCH rq:* COUNT 100',
}

export function QueryPanel({ project, store, onStore, onTrace }: {
  project: string
  store: string | null
  onStore: (s: string) => void
  onTrace?: (value: string) => void
}) {
  const stores = useLoad(() => api.stores(project), [project])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [runs, setRuns] = useState(0)
  const current = stores.data?.find((s) => s.name === store) ?? stores.data?.[0]

  async function run() {
    if (!current || !text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.query(project, current.name, text, 500)
      setResult(r)
      addHistory(project, current.name, { text, rows: r.rows.length, error: null })
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('internal', String(e))
      setResult(null)
      setError(err)
      addHistory(project, current.name, { text, rows: null, error: err.code })
    } finally {
      setBusy(false)
      setRuns((n) => n + 1)
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        <select
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          value={current?.name ?? ''}
          onChange={(e) => onStore(e.target.value)}
        >
          {stores.data?.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.type})
            </option>
          ))}
        </select>
        <span className="text-muted-foreground mr-auto text-xs">Read-only. Writes are refused by the engine.</span>
        {current && <QueryLibrary project={project} store={current.name} current={text} onPick={setText} version={runs} />}
        <Button size="sm" onClick={run} disabled={busy || !text.trim()}>
          <Play /> Run
        </Button>
      </div>
      <Textarea
        className="min-h-28 font-mono text-sm"
        placeholder={PLACEHOLDER[current?.type ?? 'sqlite']}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            run()
          }
        }}
      />
      <p className="text-muted-foreground text-xs">⌘ Enter to run · up to 500 rows</p>
      {error && <ErrorNote error={error} />}
      {result && (
        <>
          <div className="flex justify-end"><ExportMenu result={result} name={`${project}-${current?.name}-query`} /></div>
          <ResultTable result={result} onTrace={onTrace} />
        </>
      )}
    </div>
  )
}
