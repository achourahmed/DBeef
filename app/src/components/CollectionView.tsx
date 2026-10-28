import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { api } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import { ErrorNote } from './ErrorNote'
import { ResultTable } from './ResultTable'
import type { Selection } from './Sidebar'

export function CollectionView({ project, selection }: { project: string; selection: Selection | null }) {
  const [limit, setLimit] = useState(100)
  const { store, collection } = selection ?? { store: '', collection: '' }
  const desc = useLoad(selection ? () => api.describe(project, store, collection) : null, [project, store, collection])
  const rows = useLoad(selection ? () => api.rows(project, store, collection, limit) : null, [project, store, collection, limit])

  if (!selection) return <p className="text-muted-foreground p-6 text-sm">Pick a collection in the sidebar.</p>
  return (
    <div className="space-y-5 p-6">
      <div>
        <p className="text-muted-foreground text-xs">{store}</p>
        <h2 className="font-mono text-lg font-semibold">{collection}</h2>
      </div>
      {desc.error && <ErrorNote error={desc.error} />}
      {desc.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {desc.data.fields.map((f) => (
              <Badge key={f.name} variant="secondary" className="font-mono">
                {f.name}
                {f.type && <span className="text-muted-foreground ml-1">{f.type}</span>}
              </Badge>
            ))}
          </div>
          {desc.data.links.length > 0 && (
            <ul className="text-muted-foreground space-y-0.5 font-mono text-xs">
              {desc.data.links.map((l, i) => (
                <li key={i}>
                  {l.label} → {l.to_collection}
                  {l.to_field && `.${l.to_field}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Rows</span>
        <span className="text-muted-foreground ml-auto text-xs">limit</span>
        <Input
          type="number"
          min={1}
          max={10000}
          className="h-8 w-24"
          defaultValue={limit}
          onBlur={(e) => setLimit(Math.max(1, Math.min(10000, Number(e.target.value) || 100)))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      {rows.error && <ErrorNote error={rows.error} />}
      {rows.loading && !rows.data && <p className="text-muted-foreground text-sm">loading…</p>}
      {rows.data && <ResultTable result={rows.data} />}
    </div>
  )
}
