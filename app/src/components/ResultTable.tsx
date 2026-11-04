import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { QueryResult } from '@/api/client'

export type Sort = { column: string; desc: boolean }

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

export function ResultTable({ result, onTrace, sort, onSort, footer = true }: {
  result: QueryResult
  onTrace?: (value: string) => void
  sort?: Sort | null
  onSort?: (column: string) => void
  footer?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-auto rounded-md border">
        <Table>
          <TableHeader className="bg-card sticky top-0 z-10">
            <TableRow>
              {result.columns.map((c, i) => {
                const active = sort?.column === c
                const Icon = active ? (sort!.desc ? ArrowDown : ArrowUp) : ArrowUpDown
                return (
                  <TableHead key={i} className="font-mono text-xs">
                    {onSort ? (
                      <button
                        aria-label={`sort by ${c}`}
                        aria-sort={active ? (sort!.desc ? 'descending' : 'ascending') : 'none'}
                        className="group/head flex items-center gap-1 hover:underline"
                        onClick={() => onSort(c)}
                      >
                        {c}
                        <Icon className={active ? 'size-3' : 'size-3 opacity-0 group-hover/head:opacity-60'} />
                      </button>
                    ) : c}
                  </TableHead>
                )
              })}
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
      {footer && (
        <p className="text-muted-foreground text-xs">
          {result.rows.length} row{result.rows.length === 1 ? '' : 's'}
          {result.truncated && ' (more available: raise the limit)'}
        </p>
      )}
    </div>
  )
}
