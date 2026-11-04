import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TableSkeleton } from './Skeletons'
import { api } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import { ErrorNote } from './ErrorNote'
import { ExportMenu } from './ExportMenu'
import { Pager } from './Pager'
import { ResultTable, type Sort } from './ResultTable'
import { RowInspector } from './RowInspector'
import type { Selection } from './Sidebar'

const DEBOUNCE_MS = 300

function useDebounced<T>(value: T): T {
  const [slow, setSlow] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSlow(value), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value])
  return slow
}

export function CollectionView({ project, selection, onSelect, onTrace }: {
  project: string
  selection: Selection | null
  onSelect: (s: Selection) => void
  onTrace?: (value: string) => void
}) {
  const { store, collection, eq = null } = selection ?? { store: '', collection: '' }
  const [pageSize, setPageSize] = useState(100)
  const [offset, setOffset] = useState(0)
  const [sort, setSort] = useState<Sort | null>(null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<number | null>(null)
  const q = useDebounced(filter.trim()) || null
  const key = `${store}/${collection}`
  const [seenKey, setSeenKey] = useState(key)
  if (key !== seenKey) {  // a new collection starts from a clean page
    setSeenKey(key)
    setOffset(0)
    setSort(null)
    setFilter('')
    setPicked(null)
  }

  const desc = useLoad(selection ? () => api.describe(project, store, collection) : null, [project, store, collection])
  const rows = useLoad(
    selection ? () => api.rows(project, store, collection, { limit: pageSize, offset, eq, q, orderBy: sort?.column ?? null, desc: sort?.desc ?? false }) : null,
    [project, store, collection, pageSize, offset, eq?.[0], eq?.[1], q, sort?.column, sort?.desc],
  )

  function toggleSort(column: string) {
    setOffset(0)
    setPicked(null)
    setSort((s) => (s?.column === column ? (s.desc ? null : { column, desc: true }) : { column, desc: false }))
  }

  if (!selection) return null
  const row = picked !== null ? rows.data?.rows[picked] : undefined
  return (
    <div className="flex h-full min-h-0 gap-4 p-6">
    <div className="min-w-0 flex-1 space-y-5 overflow-auto">
      <div>
        <p className="text-muted-foreground text-xs">{store}</p>
        <h2 className="font-mono text-lg font-semibold">{collection}</h2>
      </div>
      {desc.error && <ErrorNote error={desc.error} />}
      {desc.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {desc.data.fields.map((f) => (
              <Badge key={f.name} variant="secondary" className="font-mono" title={f.pk ? 'primary key' : f.nullable === false ? 'not null' : undefined}>
                {f.pk && <span className="text-[#F0444B]">⚷</span>}
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Rows</span>
        <Input
          className="h-8 w-56"
          placeholder="filter rows (substring)"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setOffset(0); setPicked(null) }}
        />
        {eq && (
          <Badge variant="outline" className="gap-1 font-mono">
            {eq[0]} = {eq[1]}
            <Button variant="ghost" size="icon" className="size-4" aria-label="clear filter"
              onClick={() => onSelect({ store, collection })}>
              <X className="size-3" />
            </Button>
          </Badge>
        )}
        {sort && (
          <Badge variant="outline" className="gap-1 font-mono">
            {sort.column} {sort.desc ? '↓' : '↑'}
            <Button variant="ghost" size="icon" className="size-4" aria-label="clear sort" onClick={() => setSort(null)}>
              <X className="size-3" />
            </Button>
          </Badge>
        )}
        {rows.data && <div className="ml-auto"><ExportMenu result={rows.data} name={`${store}-${collection}`} /></div>}
      </div>
      {rows.error && <ErrorNote error={rows.error} />}
      {rows.loading && !rows.data && <TableSkeleton />}
      {rows.data && (
        <>
          <ResultTable result={rows.data} onTrace={onTrace} sort={sort} onSort={toggleSort} footer={false}
            selectedRow={picked} onSelectRow={(i) => setPicked(i === picked ? null : i)} />
          <Pager result={rows.data} pageSize={pageSize} onOffset={(o) => { setOffset(o); setPicked(null) }}
            onPageSize={(s) => { setPageSize(s); setOffset(0); setPicked(null) }} />
        </>
      )}
    </div>
      {row && rows.data && (
        <RowInspector columns={rows.data.columns} row={row} onTrace={onTrace} onClose={() => setPicked(null)} />
      )}
    </div>
  )
}
