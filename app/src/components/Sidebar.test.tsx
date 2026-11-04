import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Sidebar } from './Sidebar'

vi.mock('@/api/client', () => ({
  api: {
    stores: vi.fn(async () => [
      { name: 'runs', type: 'sqlite', status: 'ok' },
      { name: 'graph', type: 'neo4j', status: 'ok' },
    ]),
    collections: vi.fn(async (_p: string, s: string) =>
      s === 'runs'
        ? [{ name: 'runs', kind: 'table', count: 20, count_is_estimate: true }, { name: 'run_facts', kind: 'table', count: 40, count_is_estimate: true }]
        : [{ name: 'Molecule', kind: 'label', count: 1, count_is_estimate: false }]),
  },
  ApiError: class extends Error { code = 'internal' },
}))

test('the filter box narrows collections and hides stores with no match', async () => {
  render(<Sidebar project="demo" selected={null} onSelect={() => {}} />)
  await screen.findByText('Molecule')
  await userEvent.type(screen.getByPlaceholderText(/filter/i), 'fact')
  expect(screen.getByText('run_facts')).toBeInTheDocument()
  expect(screen.queryByText('Molecule')).not.toBeInTheDocument()
  expect(screen.queryByText('graph')).not.toBeInTheDocument()
  await userEvent.clear(screen.getByPlaceholderText(/filter/i))
  expect(await screen.findByText('Molecule')).toBeInTheDocument()
})
