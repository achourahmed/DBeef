import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const SHORTCUTS: [string, string][] = [
  ['⌘ K', 'Jump to a collection, a tab, or trace a value'],
  ['⌘ F', 'Trace a value across stores'],
  ['/', 'Filter the sidebar'],
  ['⌘ 1 … 4', 'Schema map · Data · Query · Trace'],
  ['⌘ ↩', 'Run the query'],
  ['?', 'This list'],
  ['Esc', 'Close panels'],
]

export function ShortcutsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>On Windows and Linux, Ctrl replaces ⌘.</SheetDescription>
        </SheetHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-4 text-sm">
          {SHORTCUTS.map(([k, what]) => (
            <div key={k} className="contents">
              <dt><kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </SheetContent>
    </Sheet>
  )
}
