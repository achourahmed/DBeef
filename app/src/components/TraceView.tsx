import { Badge } from '@/components/ui/badge'
import { api, type TraceHit } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import { cn } from '@/lib/utils'
import { ErrorNote } from './ErrorNote'
import { ResultTable } from './ResultTable'
import type { Selection } from './Sidebar'
import type { TraceQuery } from './TraceBar'

function Hit({ hit, value, onOpen, onTrace }: {
  hit: TraceHit
  value: string
  onOpen: (s: Selection) => void
  onTrace?: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          className="font-mono text-xs font-semibold hover:underline"
          onClick={() => onOpen({ store: hit.store, collection: hit.collection, eq: [hit.field, value] })}
        >
          {hit.collection}
        </button>
        <span className="text-muted-foreground font-mono text-[11px]">.{hit.field}</span>
        {hit.is_origin && <Badge className="bg-[#F0444B] text-white hover:bg-[#F0444B]">origin</Badge>}
      </div>
      <ResultTable result={hit.rows} onTrace={onTrace} />
    </div>
  )
}

export function TraceView({ project, query, onOpen, onTrace }: {
  project: string
  query: TraceQuery | null
  onOpen: (s: Selection) => void
  onTrace?: (value: string) => void
}) {
  const stores = useLoad(() => api.stores(project), [project])
  const result = useLoad(query ? () => api.trace(project, query.value, query.field) : null, [project, query])

  if (!query) return <p className="text-muted-foreground p-6 text-sm">Type a value in the trace box to see where it lives.</p>
  if (result.error) return <div className="p-6"><ErrorNote error={result.error} /></div>
  if (!stores.data || !result.data) return <p className="text-muted-foreground p-6 text-sm">tracing…</p>

  const byStore = new Map<string, TraceHit[]>()
  for (const h of result.data.hits) byStore.set(h.store, [...(byStore.get(h.store) ?? []), h])
  const down = new Map(result.data.errors.map((e) => [e.name, e]))
  const total = result.data.hits.reduce((n, h) => n + h.rows.rows.length, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-6 py-2 text-sm">
        <span className="font-mono">{query.value}</span>
        <span className="text-muted-foreground">
          {total} match{total === 1 ? '' : 'es'} in {byStore.size} of {stores.data.length} stores
        </span>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {stores.data.map((s) => {
          const hits = byStore.get(s.name) ?? []
          const err = down.get(s.name)
          return (
            <section
              key={s.name}
              role="region"
              aria-label={s.name}
              className={cn('bg-card flex w-96 shrink-0 flex-col gap-3 overflow-y-auto rounded-md border p-3',
                hits.length === 0 && !err && 'opacity-60')}
            >
              <header className="flex items-center gap-2">
                <span className={cn('size-2 rounded-full', err ? 'bg-red-500' : 'bg-emerald-500')} />
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground ml-auto text-xs">{s.type}</span>
              </header>
              {err && <p className="text-destructive text-xs break-all">{err.message}</p>}
              {!err && hits.length === 0 && <p className="text-muted-foreground text-xs">not found</p>}
              {hits.map((h) => (
                <Hit key={`${h.collection}.${h.field}`} hit={h} value={query.value} onOpen={onOpen} onTrace={onTrace} />
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
