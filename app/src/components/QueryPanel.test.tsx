import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { QueryPanel } from './QueryPanel'

vi.mock('@/api/client', () => ({
  api: {
    stores: vi.fn(async () => [{ name: 'runs', type: 'sqlite', status: 'ok' }]),
    query: vi.fn(async () => ({ columns: ['n'], rows: [[1]], truncated: false, offset: 0, total: null })),
  },
  ApiError: class extends Error { code = 'internal' },
}))

beforeEach(() => localStorage.clear())

test('a run lands in history and can be saved and picked again', async () => {
  render(<QueryPanel project="demo" store="runs" onStore={() => {}} />)
  const box = await screen.findByRole('textbox')
  await userEvent.type(box, 'SELECT 1')
  await userEvent.click(screen.getByRole('button', { name: /run/i }))
  await screen.findByText('1 row')
  await userEvent.click(screen.getByRole('button', { name: /saved queries/i }))
  expect(await screen.findByText('SELECT 1', { selector: 'span' })).toBeInTheDocument()
  await userEvent.type(screen.getByPlaceholderText(/name the current query/i), 'one{Enter}')
  expect(screen.getByText('one')).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')  // the sheet traps focus while open
  await userEvent.clear(box)
  await userEvent.click(screen.getByRole('button', { name: /saved queries/i }))
  await userEvent.click(await screen.findByText('one'))
  expect(box).toHaveValue('SELECT 1')
})
