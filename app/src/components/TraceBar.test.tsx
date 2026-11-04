import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { TraceBar } from './TraceBar'

test('submits the value and the optional field', async () => {
  const onTrace = vi.fn()
  render(<TraceBar fields={['inchikey', 'run_id']} onTrace={onTrace} />)
  await userEvent.type(screen.getByPlaceholderText(/trace a value/i), 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N{Enter}')
  expect(onTrace).toHaveBeenCalledWith({ value: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N', field: null })
  await userEvent.selectOptions(screen.getByLabelText(/field/i), 'run_id')
  await userEvent.clear(screen.getByPlaceholderText(/trace a value/i))
  await userEvent.type(screen.getByPlaceholderText(/trace a value/i), 'r1{Enter}')
  expect(onTrace).toHaveBeenLastCalledWith({ value: 'r1', field: 'run_id' })
})

test('ignores an empty submit', async () => {
  const onTrace = vi.fn()
  render(<TraceBar fields={[]} onTrace={onTrace} />)
  await userEvent.type(screen.getByPlaceholderText(/trace a value/i), '   {Enter}')
  expect(onTrace).not.toHaveBeenCalled()
})
