import { Copy, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { humanBytes } from './ResultTable'

const BINARY = /^<binary (\d+) bytes>$/

function shown(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  const bin = BINARY.exec(String(v))
  return bin ? `binary, ${humanBytes(Number(bin[1]))}` : String(v)
}

// The selected row, one field per block: long values wrap, objects are pretty-printed, scalars can be traced.
export function RowInspector({ columns, row, onTrace, onClose }: {
  columns: string[]
  row: unknown[]
  onTrace?: (value: string) => void
  onClose: () => void
}) {
  return (
    <aside className="bg-card flex h-full w-80 shrink-0 flex-col rounded-lg border" aria-label="row inspector">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">Row</span>
        <span className="text-muted-foreground truncate font-mono text-xs">{shown(row[0])}</span>
        <Button variant="ghost" size="icon" className="ml-auto size-6" aria-label="close inspector" onClick={onClose}>
          <X />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <dl className="space-y-3 p-3">
          {columns.map((c, i) => {
            const v = row[i]
            const text = shown(v)
            const scalar = v !== null && v !== undefined && typeof v !== 'object' && !BINARY.test(String(v))
            return (
              <div key={c}>
                <dt className="text-muted-foreground flex items-center gap-1 font-mono text-[11px]">
                  {c}
                  <span className="ml-auto flex gap-0.5">
                    {scalar && onTrace && (
                      <Button variant="ghost" size="icon" className="size-5" aria-label={`trace ${c}`} onClick={() => onTrace(String(v))}>
                        <Search className="size-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="size-5" aria-label={`copy ${c}`}
                      onClick={() => navigator.clipboard?.writeText(typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''))}>
                      <Copy className="size-3" />
                    </Button>
                  </span>
                </dt>
                <dd className={typeof v === 'object' && v !== null
                  ? 'bg-background mt-1 overflow-x-auto rounded-md border p-2 font-mono text-[11px] whitespace-pre'
                  : 'font-mono text-xs break-all'}>
                  {v === null || v === undefined ? <span className="text-muted-foreground italic">null</span> : text}
                </dd>
              </div>
            )
          })}
        </dl>
      </ScrollArea>
    </aside>
  )
}
