import { Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Prefs } from '@/lib/theme'

const GROUPS: { label: string; key: keyof Prefs; options: [string, string][] }[] = [
  { label: 'Palette', key: 'theme', options: [['warm', 'Warm'], ['graphite', 'Graphite']] },
  { label: 'Mode', key: 'mode', options: [['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']] },
  { label: 'Table density', key: 'density', options: [['comfortable', 'Comfortable'], ['compact', 'Compact']] },
]

export function ThemeMenu({ prefs, onChange }: { prefs: Prefs; onChange: (p: Partial<Prefs>) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="appearance">
          <Palette />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {GROUPS.map((g, i) => (
          <div key={g.key}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={prefs[g.key]} onValueChange={(v) => onChange({ [g.key]: v } as Partial<Prefs>)}>
              {g.options.map(([value, label]) => (
                <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
