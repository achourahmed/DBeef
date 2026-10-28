import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ENGINE_URL } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import { CollectionView } from '@/components/CollectionView'
import { ErrorNote } from '@/components/ErrorNote'
import { QueryPanel } from '@/components/QueryPanel'
import { SchemaMapView } from '@/components/SchemaMapView'
import { Sidebar, type Selection } from '@/components/Sidebar'

export default function App() {
  const projects = useLoad(() => api.projects(), [])
  const [picked, setPicked] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [queryStore, setQueryStore] = useState<string | null>(null)
  const [tab, setTab] = useState('map')
  const project = picked ?? projects.data?.[0]?.name ?? null

  function select(s: Selection) {
    setSelection(s)
    setQueryStore(s.store)
    setTab('data')
  }

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <img src="/favicon.svg" alt="" className="size-6" />
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
        <span className="text-muted-foreground ml-auto font-mono text-xs">{ENGINE_URL}</span>
      </header>

      {projects.error && <div className="p-6"><ErrorNote error={projects.error} /></div>}
      {project && (
        <div className="flex min-h-0 flex-1">
          <aside className="w-72 shrink-0 border-r">
            <Sidebar key={project} project={project} selected={selection} onSelect={select} />
          </aside>
          <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 flex-1 flex-col gap-0">
            <div className="border-b px-4 py-2">
              <TabsList>
                <TabsTrigger value="map">Schema map</TabsTrigger>
                <TabsTrigger value="data">Data</TabsTrigger>
                <TabsTrigger value="query">Query</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="map" className="min-h-0 flex-1">
              <SchemaMapView project={project} onSelect={select} />
            </TabsContent>
            <TabsContent value="data" className="min-h-0 flex-1 overflow-auto">
              <CollectionView project={project} selection={selection} />
            </TabsContent>
            <TabsContent value="query" className="min-h-0 flex-1 overflow-auto">
              <QueryPanel project={project} store={queryStore} onStore={setQueryStore} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  )
}
