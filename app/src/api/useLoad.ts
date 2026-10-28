import { useEffect, useState } from 'react'
import { ApiError } from './client'

type State<T> = { data?: T; error?: ApiError; loading: boolean }

// Runs `load` whenever `deps` change; a stale response never overwrites a newer one.
export function useLoad<T>(load: (() => Promise<T>) | null, deps: unknown[]): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ loading: !!load })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!load) return setState({ loading: false })
    let live = true
    setState({ loading: true })
    load().then(
      (data) => live && setState({ data, loading: false }),
      (e) => live && setState({ error: e instanceof ApiError ? e : new ApiError('internal', String(e)), loading: false }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { ...state, reload: () => setTick((t) => t + 1) }
}
