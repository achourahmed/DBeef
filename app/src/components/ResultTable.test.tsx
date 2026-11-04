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
