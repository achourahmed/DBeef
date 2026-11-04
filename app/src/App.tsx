import { lazy, Suspense, useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ENGINE_URL } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import { cn } from '@/lib/utils'
import { CollectionView } from '@/components/CollectionView'
import { CommandPalette, TABS } from '@/components/CommandPalette'
import { ShortcutsSheet } from '@/components/ShortcutsSheet'
import { ThemeMenu } from '@/components/ThemeMenu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTheme } from '@/lib/theme'

// React Flow + elkjs are most of the bundle: load them only when the map is shown.
const SchemaMapView = lazy(() => import('@/components/SchemaMapView').then((m) => ({ default: m.SchemaMapView })))
import { EngineDown, PickCollection } from '@/components/EmptyStates'
import { ErrorNote } from '@/components/ErrorNote'
import { QueryPanel } from '@/components/QueryPanel'
import { Sidebar, type Selection } from '@/components/Sidebar'
import { TraceBar, type TraceQuery } from '@/components/TraceBar'
import { TraceView } from '@/components/TraceView'

export default function App() {
  const projects = useLoad(() => api.projects(), [])
  const theme = useTheme()
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
      <header className="bg-card flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <img src="/dbeef-logo.svg" alt="" className="h-7 w-auto" />
        <span className="font-semibold tracking-tight">DBeef</span>
        {projects.data && projects.data.length > 1 ? (
          <Select value={project ?? ''} onValueChange={(v) => { setPicked(v); setSelection(null) }}>
            <SelectTrigger size="sm" className="bg-secondary h-7 rounded-full border-0 px-3 text-xs" aria-label="project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.data.map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          project && <span className="bg-secondary rounded-full px-3 py-0.5 text-xs">{project}</span>
        )}
        {project && (
          <div className="ml-auto">
            <TraceBar fields={traceFields} value={traceQuery?.value}
              onTrace={(q) => { setTraceQuery(q); setTab('trace') }} />
          </div>
        )}
        <span className={cn('text-muted-foreground hidden font-mono text-[11px] xl:inline', !project && 'ml-auto')}>{ENGINE_URL}</span>
        <ThemeMenu prefs={theme.prefs} onChange={theme.set} />
      </header>
      {project && (
        <CommandPalette project={project} open={palette} onOpenChange={setPalette}
          onSelect={select} onTab={setTab} onTrace={startTrace} />
      )}
      <ShortcutsSheet open={help} onOpenChange={setHelp} />

      {projects.error && (projects.error.code === 'engine_unreachable'
        ? <EngineDown url={ENGINE_URL} onRetry={projects.reload} />
        : <div className="p-6"><ErrorNote error={projects.error} /></div>)}
      {project && (
        <div className="flex min-h-0 flex-1">
          <aside className="bg-sidebar text-sidebar-foreground w-64 shrink-0 border-r">
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
              <Suspense fallback={<p className="text-muted-foreground p-6 text-sm">loading the map…</p>}>
                <SchemaMapView project={project} onSelect={select} dark={theme.dark} />
              </Suspense>
            </TabsContent>
            <TabsContent value="data" className="min-h-0 flex-1 overflow-hidden">
              {selection
                ? <CollectionView project={project} selection={selection} onSelect={select} onTrace={startTrace} />
                : <PickCollection onJump={() => setPalette(true)} onTab={setTab} />}
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
