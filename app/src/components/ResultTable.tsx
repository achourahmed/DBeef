import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { QueryResult } from '@/api/client'

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground italic">null</span>
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (text.startsWith('<binary')) return <span className="text-muted-foreground italic">{text}</span>
  return (
    <span className="block max-w-96 truncate" title={text}>
      {text}
    </span>
  )
}

export function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className="space-y-2">
      <div className="rounded-md border">
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
                    <Cell value={v} />
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
