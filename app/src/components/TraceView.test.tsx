import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { TraceView } from './TraceView'

vi.mock('@/api/client', () => ({
  api: {
    stores: vi.fn(async () => [
      { name: 'runs', type: 'sqlite', status: 'ok' },
      { name: 'roster', type: 'sqlite', status: 'ok' },
      { name: 'graph', type: 'neo4j', status: 'ok' },
      { name: 'jobs', type: 'redis', status: 'error', message: 'down' },
    ]),
    trace: vi.fn(async () => ({
      value: 'ASPIRIN',
      hits: [
        { store: 'runs', collection: 'runs', field: 'inchikey', is_origin: false,
          rows: { columns: ['run_id', 'inchikey'], rows: [['r1', 'ASPIRIN']], truncated: false, offset: 0, total: null } },
        { store: 'roster', collection: 'roster', field: 'inchikey', is_origin: true,
          rows: { columns: ['inchikey', 'pref_name'], rows: [['ASPIRIN', 'aspirin']], truncated: false, offset: 0, total: null } },
      ],
      errors: [{ name: 'jobs', type: 'redis', status: 'error', message: 'redis unreachable' }],
    })),
  },
  ApiError: class extends Error { code = 'internal' },
}))

test('shows one lane per store with hits, origin, not-found and errors', async () => {
  const onOpen = vi.fn()
  render(<TraceView project="demo" query={{ value: 'ASPIRIN', field: null }} onOpen={onOpen} />)
  const lanes = await screen.findAllByRole('region')
  expect(lanes.map((l) => l.getAttribute('aria-label'))).toEqual(['runs', 'roster', 'graph', 'jobs'])
  expect(within(lanes[0]).getByText('r1')).toBeInTheDocument()
  expect(within(lanes[1]).getByText(/origin/i)).toBeInTheDocument()
  expect(within(lanes[2]).getByText(/not found/i)).toBeInTheDocument()
  expect(within(lanes[3]).getByText(/redis unreachable/)).toBeInTheDocument()
  await userEvent.click(within(lanes[0]).getByRole('button', { name: /runs/ }))
  expect(onOpen).toHaveBeenCalledWith({ store: 'runs', collection: 'runs', eq: ['inchikey', 'ASPIRIN'] })
})
