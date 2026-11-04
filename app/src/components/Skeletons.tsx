import { Skeleton } from '@/components/ui/skeleton'

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-label="loading">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-6 w-full opacity-70" />)}
    </div>
  )
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ml-8 space-y-1.5 px-2 py-1" aria-label="loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-3.5" style={{ width: `${80 - i * 15}%` }} />)}
    </div>
  )
}
