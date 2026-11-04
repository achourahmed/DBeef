import { ArrowDown, ArrowUp, ArrowUpDown, Check, Search, X } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { QueryResult } from '@/api/client'
import { cn } from '@/lib/utils'

export type Sort = { column: string; desc: boolean }

const BINARY = /^<binary (\d+) bytes>$/

export function humanBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} kB` : `${(n / 1024 ** 2).toFixed(1)} MB`
}

const pill = 'bg-secondary text-secondary-foreground rounded-full px-2 py-px font-mono text-[11px]'

function Cell({ value, onTrace }: { value: unknown; onTrace?: (value: string) => void }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground italic">null</span>
  if (typeof value === 'boolean') {
    return value
      ? <Check aria-label="true" className="text-ok size-3.5" />
      : <X aria-label="false" className="text-muted-foreground size-3.5" />
  }
  if (Array.isArray(value)) return <span className={pill} title={JSON.stringify(value)}>[ {value.length} ]</span>
  if (typeof value === 'object') {
    return <span className={pill} title={JSON.stringify(value)}>{'{'} {Object.keys(value).length} {'}'}</span>
  }
  const text = String(value)
  const bin = BINARY.exec(text)
  if (bin) return <span className={cn(pill, 'text-muted-foreground')}>binary {humanBytes(Number(bin[1]))}</span>
  return (
    <span className="group/cell inline-flex max-w-96 items-center gap-1">
      <span className="truncate" title={text}>{text}</span>
      {onTrace && (
        <button
          aria-label={`trace ${text}`}
          className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover/cell:opacity-100 focus:opacity-100"
          onClick={(e) => { e.stopPropagation(); onTrace(text) }}
        >
          <Search className="size-3" />
        </button>
      )}
    </span>
  )
}

export function ResultTable({ result, onTrace, sort, onSort, footer = true, onSelectRow, selectedRow = null }: {
  result: QueryResult
  onTrace?: (value: string) => void
  sort?: Sort | null
  onSort?: (column: string) => void
  footer?: boolean
  onSelectRow?: (index: number) => void
  selectedRow?: number | null
}) {
  // A column is numeric when every non-null value in this page is a number: right-align it.
  const numeric = result.columns.map((_, j) => {
    const vals = result.rows.map((r) => r[j]).filter((v) => v !== null && v !== undefined)
    return vals.length > 0 && vals.every((v) => typeof v === 'number')
  })
  return (
    <div className="space-y-2">
      <div className="bg-card overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-card sticky top-0 z-10">
            <TableRow>
              {result.columns.map((c, i) => {
                const active = sort?.column === c
                const Icon = active ? (sort!.desc ? ArrowDown : ArrowUp) : ArrowUpDown
                return (
                  <TableHead key={i} className={cn('text-muted-foreground font-mono text-xs', numeric[i] && 'text-right')}>
                    {onSort ? (
                      <button
                        aria-label={`sort by ${c}`}
                        aria-sort={active ? (sort!.desc ? 'descending' : 'ascending') : 'none'}
                        className={cn('group/head inline-flex items-center gap-1 hover:underline', active && 'text-foreground')}
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
              <TableRow
                key={i}
                aria-selected={onSelectRow ? selectedRow === i : undefined}
                className={cn(onSelectRow && 'cursor-pointer', selectedRow === i && 'bg-brand-soft hover:bg-brand-soft')}
                onClick={onSelectRow ? () => onSelectRow(i) : undefined}
              >
                {row.map((v, j) => (
                  <TableCell key={j} className={cn('font-mono text-xs', numeric[j] && 'text-right tabular-nums')}>
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
