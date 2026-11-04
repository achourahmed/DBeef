import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { CommandPalette } from './CommandPalette'

vi.mock('@/api/client', () => ({
  api: {
    stores: vi.fn(async () => [{ name: 'runs', type: 'sqlite', status: 'ok' }]),
    collections: vi.fn(async () => [{ name: 'run_facts', kind: 'table', count: 40, count_is_estimate: true }]),
  },
  ApiError: class extends Error { code = 'internal' },
}))

test('jumps to a collection, a tab, or starts a trace', async () => {
  const onSelect = vi.fn()
  const onTab = vi.fn()
  const onTrace = vi.fn()
  const onOpenChange = vi.fn()
  render(<CommandPalette project="demo" open onOpenChange={onOpenChange} onSelect={onSelect} onTab={onTab} onTrace={onTrace} />)
  await userEvent.click(await screen.findByText('run_facts'))
  expect(onSelect).toHaveBeenCalledWith({ store: 'runs', collection: 'run_facts' })
  await userEvent.click(screen.getByText('Schema map'))
  expect(onTab).toHaveBeenCalledWith('map')
  await userEvent.type(screen.getByPlaceholderText(/jump to/i), 'BSYNRY')
  await userEvent.click(screen.getByText(/trace “BSYNRY”/i))
  expect(onTrace).toHaveBeenCalledWith('BSYNRY')
})
