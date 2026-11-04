import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Pager } from './Pager'

const result = (n: number, offset: number, truncated: boolean, total: number | null) => ({
  columns: ['x'], rows: Array.from({ length: n }, (_, i) => [i]), truncated, offset, total,
})

test('shows the row range, pages forward and back, and changes the page size', async () => {
  const onOffset = vi.fn()
  const onPageSize = vi.fn()
  const { rerender } = render(
    <Pager result={result(50, 0, true, 120)} pageSize={50} onOffset={onOffset} onPageSize={onPageSize} />,
  )
  expect(screen.getByText('rows 1–50 of 120')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: /next/i }))
  expect(onOffset).toHaveBeenCalledWith(50)
  rerender(<Pager result={result(20, 100, false, 120)} pageSize={50} onOffset={onOffset} onPageSize={onPageSize} />)
  expect(screen.getByText('rows 101–120 of 120')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: /previous/i }))
  expect(onOffset).toHaveBeenLastCalledWith(50)
  await userEvent.selectOptions(screen.getByLabelText(/page size/i), '500')
  expect(onPageSize).toHaveBeenCalledWith(500)
})

test('says "rows 1–0" never: an empty page reads "no rows"', () => {
  render(<Pager result={result(0, 0, false, null)} pageSize={50} onOffset={() => {}} onPageSize={() => {}} />)
  expect(screen.getByText('no rows')).toBeInTheDocument()
})
