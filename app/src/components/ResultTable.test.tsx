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

test('sortable headers report clicks and show the direction', async () => {
  const { default: userEvent } = await import('@testing-library/user-event')
  const { vi } = await import('vitest')
  const onSort = vi.fn()
  const result = { columns: ['run_id', 'score'], rows: [['r1', 1]], truncated: false, offset: 0, total: null }
  const { rerender } = render(<ResultTable result={result} onSort={onSort} sort={null} />)
  await userEvent.click(screen.getByRole('button', { name: /sort by score/i }))
  expect(onSort).toHaveBeenCalledWith('score')
  rerender(<ResultTable result={result} onSort={onSort} sort={{ column: 'score', desc: true }} />)
  expect(screen.getByRole('button', { name: /sort by score/i })).toHaveAttribute('aria-sort', 'descending')
})

test('cells render by type: numbers right-aligned, objects and lists as size pills, booleans, binary', () => {
  render(
    <ResultTable
      result={{ columns: ['n', 'obj', 'list', 'ok', 'blob'], rows: [[0.82, { a: 1, b: 2 }, [1, 2, 3], true, '<binary 2048 bytes>']], truncated: false, offset: 0, total: null }}
    />,
  )
  expect(screen.getByText('0.82').closest('td')).toHaveClass('text-right')
  expect(screen.getByText('{ 2 }')).toBeInTheDocument()
  expect(screen.getByText('[ 3 ]')).toBeInTheDocument()
  expect(screen.getByLabelText('true')).toBeInTheDocument()
  expect(screen.getByText('binary 2 kB')).toBeInTheDocument()
})

test('rows are selectable when onSelectRow is given', async () => {
  const { default: userEvent } = await import('@testing-library/user-event')
  const { vi } = await import('vitest')
  const onSelectRow = vi.fn()
  render(<ResultTable onSelectRow={onSelectRow} selectedRow={1}
    result={{ columns: ['id'], rows: [['a'], ['b']], truncated: false, offset: 0, total: null }} />)
  expect(screen.getByText('b').closest('tr')).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(screen.getByText('a'))
  expect(onSelectRow).toHaveBeenCalledWith(0)
})
