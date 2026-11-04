import { useRef, useState } from 'react'
import { BookMarked, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { download } from '@/lib/export'
import { exportStore, importStore, load, removeSaved, renameSaved, saveQuery } from '@/lib/queryStore'

// Saved queries and history for one project+store, kept in this browser (see lib/queryStore).
export function QueryLibrary({ project, store, current, onPick, version }: {
  project: string
  store: string
  current: string
  onPick: (text: string) => void
  version: number // bumped by the parent after each run so the list refreshes
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [tick, setTick] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  const data = load(project, store)
  void version
  void tick
  const refresh = () => setTick((t) => t + 1)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8" aria-label="saved queries and history">
          <BookMarked /> Library
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-96 flex-col gap-4 overflow-y-auto sm:max-w-96">
        <SheetHeader>
          <SheetTitle>Queries for {store}</SheetTitle>
          <SheetDescription>Saved in this browser. Export to move them elsewhere.</SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4">
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim() && current.trim()) { saveQuery(project, store, name.trim(), current); setName(''); refresh() } }}>
            <Input className="h-8" placeholder="name the current query…" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" size="sm" className="h-8" disabled={!name.trim() || !current.trim()}>Save</Button>
          </form>
          <p className="text-muted-foreground text-xs font-medium uppercase">Saved</p>
          {data.saved.length === 0 && <p className="text-muted-foreground text-xs">nothing saved yet</p>}
          <ul className="space-y-1">
            {data.saved.map((s) => (
              <li key={s.name} className="group flex items-start gap-1">
                <button className="hover:bg-muted min-w-0 flex-1 rounded px-1 text-left" onClick={() => { onPick(s.text); setOpen(false) }}>
                  <span className="block text-sm font-medium">{s.name}</span>
                  <span className="text-muted-foreground block truncate font-mono text-xs">{s.text}</span>
                </button>
                <Button variant="ghost" size="icon" className="size-6" aria-label={`rename ${s.name}`}
                  onClick={() => { const to = prompt('New name', s.name); if (to?.trim()) { renameSaved(project, store, s.name, to.trim()); refresh() } }}>
                  ✎
                </Button>
                <Button variant="ghost" size="icon" className="size-6" aria-label={`delete ${s.name}`}
                  onClick={() => { removeSaved(project, store, s.name); refresh() }}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground pt-2 text-xs font-medium uppercase">History</p>
          {data.history.length === 0 && <p className="text-muted-foreground text-xs">no queries run yet</p>}
          <ul className="space-y-1">
            {data.history.map((h) => (
              <li key={h.at}>
                <button className="hover:bg-muted w-full rounded px-1 text-left" onClick={() => { onPick(h.text); setOpen(false) }}>
                  <span className="block truncate font-mono text-xs">{h.text}</span>
                  <span className="text-muted-foreground block text-[11px]">
                    {new Date(h.at).toLocaleString()} · {h.error ? <span className="text-destructive">{h.error}</span> : `${h.rows} rows`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => download(`dbeef-${project}-${store}-queries.json`, exportStore(project, store), 'application/json')}>
              Export JSON
            </Button>
            <Button variant="outline" size="sm" onClick={() => file.current?.click()}>Import JSON</Button>
            <input ref={file} type="file" accept="application/json" className="hidden" aria-label="import file"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                try { importStore(project, store, await f.text()); refresh() } catch (err) { alert(String(err)) }
                e.target.value = ''
              }} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
