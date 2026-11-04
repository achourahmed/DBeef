import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ENGINE_URL } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import { cn } from '@/lib/utils'
import { CollectionView } from '@/components/CollectionView'
import { CommandPalette, TABS } from '@/components/CommandPalette'
import { ShortcutsSheet } from '@/components/ShortcutsSheet'
import { ErrorNote } from '@/components/ErrorNote'
import { QueryPanel } from '@/components/QueryPanel'
import { SchemaMapView } from '@/components/SchemaMapView'
import { Sidebar, type Selection } from '@/components/Sidebar'
import { TraceBar, type TraceQuery } from '@/components/TraceBar'
import { TraceView } from '@/components/TraceView'

export default function App() {
  const projects = useLoad(() => api.projects(), [])
  const [picked, setPicked] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [queryStore, setQueryStore] = useState<string | null>(null)
  const [tab, setTab] = useState('map')
  const [traceQuery, setTraceQuery] = useState<TraceQuery | null>(null)
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)
  const project = picked ?? projects.data?.[0]?.name ?? null
  // Field names the trace box offers: the ends of every configured link.
  const links = useLoad(project ? () => api.links(project) : null, [project])
  const startTrace = (value: string) => { setTraceQuery({ value, field: null }); setTab('trace') }

  useEffect(() => {
    // Global shortcuts: ⌘K palette, ⌘1–4 tabs, ? help, Esc closes. ⌘F and / live in TraceBar and Sidebar.
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPalette((p) => !p) }
      else if ((e.metaKey || e.ctrlKey) && TABS.some((t) => t.key === e.key)) {
        e.preventDefault(); setTab(TABS.find((t) => t.key === e.key)!.value)
      } else if ((e.key === '?' || (e.shiftKey && e.key === '/')) && !typing) setHelp(true)
      else if (e.key === 'Escape') { setPalette(false); setHelp(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const traceFields = [...new Set((links.data ?? []).flatMap((l) => [l.from.field, l.to.field]))].sort()

  function select(s: Selection) {
    setSelection(s)
    setQueryStore(s.store)
    setTab('data')
  }

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <img src="/dbeef-logo.svg" alt="" className="h-8 w-auto" />
        <span className="font-semibold">DBeef</span>
        {projects.data && projects.data.length > 1 ? (
          <select
            className="border-input bg-background h-7 rounded-md border px-2 text-sm"
            value={project ?? ''}
            onChange={(e) => {
              setPicked(e.target.value)
              setSelection(null)
            }}
          >
            {projects.data.map((p) => <option key={p.name}>{p.name}</option>)}
          </select>
        ) : (
          project && <span className="text-muted-foreground text-sm">{project}</span>
        )}
        {project && (
          <div className="ml-auto">
            <TraceBar fields={traceFields} value={traceQuery?.value}
              onTrace={(q) => { setTraceQuery(q); setTab('trace') }} />
          </div>
        )}
        <span className={cn('text-muted-foreground font-mono text-xs', !project && 'ml-auto')}>{ENGINE_URL}</span>
      </header>
      {project && (
        <CommandPalette project={project} open={palette} onOpenChange={setPalette}
          onSelect={select} onTab={setTab} onTrace={startTrace} />
      )}
      <ShortcutsSheet open={help} onOpenChange={setHelp} />

      {projects.error && <div className="p-6"><ErrorNote error={projects.error} /></div>}
      {project && (
        <div className="flex min-h-0 flex-1">
          <aside className="w-72 shrink-0 border-r">
            <Sidebar key={project} project={project} selected={selection} onSelect={select} />
          </aside>
          <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 flex-1 flex-col gap-0">
            <div className="flex items-center border-b px-4 py-2">
              <TabsList>
                {TABS.map((t) => <TabsTrigger key={t.value} value={t.value} title={`⌘${t.key}`}>{t.label}</TabsTrigger>)}
              </TabsList>
              <div className="text-muted-foreground ml-auto flex gap-3 text-xs">
                <button className="hover:text-foreground" onClick={() => setPalette(true)}>⌘K jump</button>
                <button className="hover:text-foreground" onClick={() => setHelp(true)}>? shortcuts</button>
              </div>
            </div>
            <TabsContent value="map" className="min-h-0 flex-1">
              <SchemaMapView project={project} onSelect={select} />
            </TabsContent>
            <TabsContent value="data" className="min-h-0 flex-1 overflow-auto">
              <CollectionView project={project} selection={selection} onSelect={select} onTrace={startTrace} />
            </TabsContent>
            <TabsContent value="query" className="min-h-0 flex-1 overflow-auto">
              <QueryPanel project={project} store={queryStore} onStore={setQueryStore} onTrace={startTrace} />
            </TabsContent>
            <TabsContent value="trace" className="min-h-0 flex-1">
              <TraceView project={project} query={traceQuery} onOpen={select} onTrace={startTrace} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  )
}
