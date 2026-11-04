import { Search } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { QueryResult } from '@/api/client'

function Cell({ value, onTrace }: { value: unknown; onTrace?: (value: string) => void }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground italic">null</span>
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (text.startsWith('<binary')) return <span className="text-muted-foreground italic">{text}</span>
  // Only plain scalars can be traced: an object or a binary blob is not an identifier.
  const traceable = onTrace && typeof value !== 'object' && typeof value !== 'boolean'
  return (
    <span className="group/cell flex max-w-96 items-center gap-1">
      <span className="truncate" title={text}>{text}</span>
      {traceable && (
        <button
          aria-label={`trace ${text}`}
          className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover/cell:opacity-100 focus:opacity-100"
          onClick={() => onTrace(text)}
        >
          <Search className="size-3" />
        </button>
      )}
    </span>
  )
}

export function ResultTable({ result, onTrace }: { result: QueryResult; onTrace?: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {result.columns.map((c, i) => (
                <TableHead key={i} className="font-mono text-xs">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row, i) => (
              <TableRow key={i}>
                {row.map((v, j) => (
                  <TableCell key={j} className="font-mono text-xs">
                    <Cell value={v} onTrace={onTrace} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-xs">
        {result.rows.length} row{result.rows.length === 1 ? '' : 's'}
        {result.truncated && ' (more available: raise the limit)'}
      </p>
    </div>
  )
}
