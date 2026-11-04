import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { EngineDown, PickCollection } from './EmptyStates'

test('the empty data view offers the three ways in', async () => {
  const onJump = vi.fn()
  const onTab = vi.fn()
  render(<PickCollection onJump={onJump} onTab={onTab} />)
  await userEvent.click(screen.getByRole('button', { name: /jump to a collection/i }))
  expect(onJump).toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: /open the schema map/i }))
  expect(onTab).toHaveBeenCalledWith('map')
  await userEvent.click(screen.getByRole('button', { name: /trace a value/i }))
  expect(onTab).toHaveBeenCalledWith('trace')
})

test('an unreachable engine gets the start command and a retry', async () => {
  const onRetry = vi.fn()
  render(<EngineDown url="http://127.0.0.1:8765" onRetry={onRetry} />)
  expect(screen.getByText(/can't reach the engine/i)).toBeInTheDocument()
  expect(screen.getByText(/python -m dbeef --config/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /retry/i }))
  expect(onRetry).toHaveBeenCalled()
})
