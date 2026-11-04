import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { RowInspector } from './RowInspector'

test('lists every field, pretty-prints JSON and offers trace and copy', async () => {
  const onTrace = vi.fn()
  const onClose = vi.fn()
  const writeText = vi.fn(async () => {})
  Object.assign(navigator, { clipboard: { writeText } })
  render(
    <RowInspector
      columns={['run_id', 'inchikey', 'result']}
      row={['r-0398', 'RZVAJINKPMORJF-UHFFFAOYSA-N', { verdict: 'supported', gates: 5 }]}
      onTrace={onTrace}
      onClose={onClose}
    />,
  )
  expect(screen.getByText('RZVAJINKPMORJF-UHFFFAOYSA-N')).toBeInTheDocument()
  expect(screen.getByText(/"verdict": "supported"/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'trace inchikey' }))
  expect(onTrace).toHaveBeenCalledWith('RZVAJINKPMORJF-UHFFFAOYSA-N')
  await userEvent.click(screen.getByRole('button', { name: 'copy run_id' }))
  expect(writeText).toHaveBeenCalledWith('r-0398')
  expect(screen.queryByRole('button', { name: 'trace result' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /close/i }))
  expect(onClose).toHaveBeenCalled()
})
