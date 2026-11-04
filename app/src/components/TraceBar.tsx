import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

export type TraceQuery = { value: string; field: string | null }

export function TraceBar({ fields, onTrace, value = '' }: {
  fields: string[]
  onTrace: (q: TraceQuery) => void
  value?: string
}) {
  const [text, setText] = useState(value)
  const [field, setField] = useState<string>('')
  const [seen, setSeen] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  if (value !== seen) {  // a trace started elsewhere (a cell action) shows its value here
    setSeen(value)
    setText(value)
  }
  useEffect(() => {
    // ⌘F focuses the trace box instead of the browser's find.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) onTrace({ value: text.trim(), field: field || null })
      }}
    >
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          ref={ref}
          className="h-8 w-80 pl-7 font-mono text-xs"
          placeholder="Trace a value across stores… (⌘F)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <select
        aria-label="field"
        className="border-input bg-background h-8 rounded-md border px-2 text-xs"
        value={field}
        onChange={(e) => setField(e.target.value)}
      >
        <option value="">any field</option>
        {fields.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    </form>
  )
}
