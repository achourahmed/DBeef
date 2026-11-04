import { useState } from 'react'
import { Database, Layers, Search, Table2 } from 'lucide-react'
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
} from '@/components/ui/command'
import { api, type Collection } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import type { Selection } from './Sidebar'

export const TABS = [
  { value: 'map', label: 'Schema map', key: '1' },
  { value: 'data', label: 'Data', key: '2' },
  { value: 'query', label: 'Query', key: '3' },
  { value: 'trace', label: 'Trace', key: '4' },
]

export function CommandPalette({ project, open, onOpenChange, onSelect, onTab, onTrace }: {
  project: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (s: Selection) => void
  onTab: (tab: string) => void
  onTrace: (value: string) => void
}) {
  const [text, setText] = useState('')
  // Every collection of every reachable store, loaded when the palette opens.
  const all = useLoad(open ? async () => {
    const stores = await api.stores(project)
    const lists = await Promise.all(stores.map((s) =>
      s.status === 'ok' ? api.collections(project, s.name).catch(() => [] as Collection[]) : Promise.resolve([] as Collection[])))
    return stores.flatMap((s, i) => lists[i].map((c) => ({ store: s.name, type: s.type, collection: c.name })))
  } : null, [project, open])

  const done = (fn: () => void) => () => {
    fn()
    setText('')
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Jump to" description="collections, tabs, trace">
      <Command>
      <CommandInput placeholder="Jump to a collection, a tab, or trace a value…" value={text} onValueChange={setText} />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {text.trim() && (
          <CommandGroup heading="Trace">
            <CommandItem value={`trace ${text}`} onSelect={done(() => onTrace(text.trim()))}>
              <Search /> Trace “{text.trim()}” across stores
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Collections">
          {all.data?.map((c) => (
            <CommandItem key={`${c.store}/${c.collection}`} value={`${c.store} ${c.collection}`}
              onSelect={done(() => onSelect({ store: c.store, collection: c.collection }))}>
              {c.type === 'neo4j' ? <Layers /> : c.type === 'redis' ? <Database /> : <Table2 />}
              <span className="font-mono">{c.collection}</span>
              <span className="text-muted-foreground ml-auto text-xs">{c.store}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Tabs">
          {TABS.map((t) => (
            <CommandItem key={t.value} value={`tab ${t.label}`} onSelect={done(() => onTab(t.value))}>
              {t.label}
              <CommandShortcut>⌘{t.key}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
