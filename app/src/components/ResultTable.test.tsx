import { render, screen } from '@testing-library/react'
import { ResultTable } from './ResultTable'

test('renders columns, rows and the truncation note', () => {
  render(
    <ResultTable
      result={{ columns: ['run_id', 'score'], rows: [['r1', null], ['r2', 0.5]], truncated: true, offset: 0, total: null }}
    />,
  )
  expect(screen.getByText('run_id')).toBeInTheDocument()
  expect(screen.getByText('r2')).toBeInTheDocument()
  expect(screen.getByText('null')).toBeInTheDocument()
  expect(screen.getByText(/more available/)).toBeInTheDocument()
})

test('offers to trace a cell value when onTrace is given', async () => {
  const { default: userEvent } = await import('@testing-library/user-event')
  const { vi } = await import('vitest')
  const onTrace = vi.fn()
  render(
    <ResultTable
      onTrace={onTrace}
      result={{ columns: ['run_id', 'meta'], rows: [['r1', { a: 1 }]], truncated: false, offset: 0, total: null }}
    />,
  )
  const buttons = screen.getAllByRole('button', { name: /trace/i })
  expect(buttons).toHaveLength(1) // objects get no trace button
  await userEvent.click(buttons[0])
  expect(onTrace).toHaveBeenCalledWith('r1')
})
