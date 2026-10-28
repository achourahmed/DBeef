import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { ApiError } from '@/api/client'

export function ErrorNote({ error }: { error: ApiError }) {
  return (
    <Alert variant="destructive">
      <AlertTitle className="font-mono text-xs">{error.code}</AlertTitle>
      <AlertDescription className="break-all">{error.message}</AlertDescription>
    </Alert>
  )
}
