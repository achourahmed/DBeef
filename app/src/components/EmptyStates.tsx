import { Map, RefreshCw, Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PickCollection({ onJump, onTab }: { onJump: () => void; onTab: (tab: string) => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h2 className="text-lg font-semibold">Open a collection</h2>
        <p className="text-muted-foreground text-sm">Pick one in the sidebar, or start from one of these.</p>
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={onJump}><Sparkles /> Jump to a collection <kbd className="text-muted-foreground ml-auto text-xs">⌘K</kbd></Button>
          <Button variant="outline" onClick={() => onTab('map')}><Map /> Open the schema map <kbd className="text-muted-foreground ml-auto text-xs">⌘1</kbd></Button>
          <Button variant="outline" onClick={() => onTab('trace')}><Search /> Trace a value <kbd className="text-muted-foreground ml-auto text-xs">⌘F</kbd></Button>
        </div>
      </div>
    </div>
  )
}

export function EngineDown({ url, onRetry }: { url: string; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-lg space-y-4">
        <img src="/dbeef-logo.svg" alt="" className="h-12 w-auto opacity-80" />
        <h2 className="text-lg font-semibold">Can't reach the engine</h2>
        <p className="text-muted-foreground text-sm">
          The UI is looking for it at <span className="font-mono">{url}</span>. Start it, then retry.
        </p>
        <pre className="bg-card overflow-x-auto rounded-md border p-3 font-mono text-xs">
{`cd engine
.venv/bin/python -m dbeef --config examples/dbeef.example.yaml \\
  --port 8765 --dev-token dev --allow-origin http://localhost:5173`}
        </pre>
        <p className="text-muted-foreground text-xs">With Docker: <span className="font-mono">docker compose up -d --build</span></p>
        <Button onClick={onRetry}><RefreshCw /> Retry</Button>
      </div>
    </div>
  )
}
