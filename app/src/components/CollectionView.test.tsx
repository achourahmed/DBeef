import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { CollectionView } from './CollectionView'

const rows = vi.fn(async () => ({
  columns: ['run_id', 'inchikey'], rows: [['r1', 'AAA'], ['r2', 'BBB']], truncated: false, offset: 0, total: null,
}))
vi.mock('@/api/client', () => ({
  api: {
    describe: vi.fn(async () => ({
      collection: { name: 'runs', kind: 'table', count: 2, count_is_estimate: false },
      fields: [{ name: 'run_id', type: 'TEXT', pk: true, nullable: false }, { name: 'inchikey', type: 'TEXT', pk: false, nullable: true }],
      links: [],
    })),
    rows: (...a: unknown[]) => rows(...(a as [])),
  },
  ApiError: class extends Error { code = 'internal' },
}))

test('filter box and header sort drive the rows request', async () => {
  render(<CollectionView project="demo" selection={{ store: 'runs', collection: 'runs' }} onSelect={() => {}} />)
  await screen.findByText('r1')
  expect(rows).toHaveBeenLastCalledWith('demo', 'runs', 'runs', expect.objectContaining({ limit: 100, offset: 0, q: null, orderBy: null }))
  await userEvent.type(screen.getByPlaceholderText(/filter rows/i), 'BB')
  await waitFor(() => expect(rows).toHaveBeenLastCalledWith('demo', 'runs', 'runs', expect.objectContaining({ q: 'BB', offset: 0 })))
  await userEvent.click(screen.getByRole('button', { name: /sort by inchikey/i }))
  await waitFor(() => expect(rows).toHaveBeenLastCalledWith('demo', 'runs', 'runs', expect.objectContaining({ orderBy: 'inchikey', desc: false })))
  await userEvent.click(screen.getByRole('button', { name: /sort by inchikey/i }))
  await waitFor(() => expect(rows).toHaveBeenLastCalledWith('demo', 'runs', 'runs', expect.objectContaining({ orderBy: 'inchikey', desc: true })))
  expect(screen.getByTitle('primary key')).toHaveTextContent('run_id')
})
