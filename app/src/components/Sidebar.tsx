import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api, type StoreStatus } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import { cn } from '@/lib/utils'
import { ListSkeleton } from './Skeletons'

export type Selection = { store: string; collection: string; eq?: [string, string] | null }

const inInput = (e: KeyboardEvent) => ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)

function StoreItem({ project, store, selected, onSelect, filter }: {
  project: string
  store: StoreStatus
  selected: Selection | null
  onSelect: (s: Selection) => void
  filter: string
}) {
  const [open, setOpen] = useState(true)
  const ok = store.status === 'ok'
  const colls = useLoad(ok && open ? () => api.collections(project, store.name) : null, [project, store.name, ok, open])
  const Chevron = open ? ChevronDown : ChevronRight
  const shown = (colls.data ?? []).filter((c) => c.name.toLowerCase().includes(filter))
  // With a filter, a store stays only if its name or one of its collections matches.
  if (filter && !store.name.toLowerCase().includes(filter) && shown.length === 0) return null
  return (
    <li>
      <button
        className="hover:bg-sidebar-accent/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium"
        onClick={() => setOpen(!open)}
        title={store.message ?? undefined}
      >
        <Chevron className="text-muted-foreground size-3.5 shrink-0" />
        <span className={cn('size-2 shrink-0 rounded-full', ok ? 'bg-ok' : 'bg-brand')} />
        <span className="truncate">{store.name}</span>
        <span className="text-muted-foreground ml-auto text-xs">{store.type}</span>
      </button>
      {open && !ok && (
        <p className="text-muted-foreground ml-8 px-2 pb-1 text-xs" title={store.message ?? undefined}>
          Can't reach this store
        </p>
      )}
      {open && colls.loading && <ListSkeleton />}
      {open && colls.error && <p className="text-destructive ml-8 px-2 text-xs">{colls.error.message}</p>}
      {open && colls.data && (
        <ul className="ml-6">
          {shown.map((c) => {
            const active = selected?.store === store.name && selected.collection === c.name
            return (
              <li key={c.name}>
                <button
                  className={cn(
                    'hover:bg-sidebar-accent/60 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-xs',
                    active && 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold',
                  )}
                  onClick={() => onSelect({ store: store.name, collection: c.name })}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                    {c.count === null ? '' : `${c.count_is_estimate ? '~' : ''}${c.count.toLocaleString()}`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

export function Sidebar({ project, selected, onSelect }: {
  project: string
  selected: Selection | null
  onSelect: (s: Selection) => void
}) {
  const stores = useLoad(() => api.stores(project), [project])
  const [filter, setFilter] = useState('')
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // "/" focuses the filter, as in GitHub and Slack.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !inInput(e)) {
        e.preventDefault()
        box.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        <Input ref={box} className="bg-background mb-2 h-7 text-xs" placeholder="filter stores and collections  ( / )"
          value={filter} onChange={(e) => setFilter(e.target.value)} />
        <p className="text-muted-foreground px-2 pt-1 pb-2 text-xs font-medium tracking-wide uppercase">Stores</p>
        {stores.error && <p className="text-destructive px-2 text-xs">{stores.error.message}</p>}
        <ul className="space-y-1">
          {stores.data?.map((s) => (
            <StoreItem key={s.name} project={project} store={s} selected={selected} onSelect={onSelect}
              filter={filter.trim().toLowerCase()} />
          ))}
        </ul>
      </div>
    </ScrollArea>
  )
}
