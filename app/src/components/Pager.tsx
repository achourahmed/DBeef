import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { QueryResult } from '@/api/client'

export const PAGE_SIZES = [50, 100, 500]

export function Pager({ result, pageSize, onOffset, onPageSize }: {
  result: QueryResult
  pageSize: number
  onOffset: (offset: number) => void
  onPageSize: (size: number) => void
}) {
  const n = result.rows.length
  const first = result.offset + 1
  const last = result.offset + n
  const range = n === 0 ? 'no rows' : `rows ${first}–${last}${result.total !== null ? ` of ${result.total}` : ''}`
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <span>{range}</span>
      {result.truncated && result.total === null && <span>(more available)</span>}
      <div className="ml-auto flex items-center gap-1">
        <label className="flex items-center gap-1">
          page size
          <select
            aria-label="page size"
            className="border-input bg-background h-7 rounded-md border px-1"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <Button variant="outline" size="icon" className="size-7" aria-label="previous page"
          disabled={result.offset === 0} onClick={() => onOffset(Math.max(0, result.offset - pageSize))}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" className="size-7" aria-label="next page"
          disabled={!result.truncated} onClick={() => onOffset(result.offset + pageSize)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
