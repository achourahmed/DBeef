import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { QueryResult } from '@/api/client'
import { download, toCSV, toJSON, toMarkdown } from '@/lib/export'

// Exports what is on screen: the current page or result, never the whole table.
export function ExportMenu({ result, name }: { result: QueryResult; name: string }) {
  const formats = [
    { label: 'CSV', ext: 'csv', mime: 'text/csv', body: toCSV },
    { label: 'JSON', ext: 'json', mime: 'application/json', body: toJSON },
    { label: 'Markdown table', ext: 'md', mime: 'text/markdown', body: toMarkdown },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7" aria-label="export">
          <Download /> Export {result.rows.length} row{result.rows.length === 1 ? '' : 's'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.map((f) => (
          <DropdownMenuItem key={f.ext} onClick={() => download(`${name}.${f.ext}`, f.body(result), f.mime)}>
            {f.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(toMarkdown(result))}>
          Copy as Markdown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
