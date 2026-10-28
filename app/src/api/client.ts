// Typed client for the engine API. Types come from the engine's /openapi.json (npm run gen:api).
import type { components } from './schema'

type S = components['schemas']
export type ProjectInfo = S['ProjectInfo']
export type StoreStatus = S['StoreStatus']
export type Collection = S['Collection']
export type Description = S['Description']
export type QueryResult = S['QueryResult']
export type SchemaMap = S['SchemaMap']
export type MapNode = S['MapNode']
export type MapEdge = S['MapEdge']

// Tauri will pass these in later; in the browser they come from ?engine= and ?token=, then .env.
const params = new URLSearchParams(location.search)
export const ENGINE_URL = params.get('engine') ?? import.meta.env.VITE_DBEEF_URL ?? 'http://127.0.0.1:8765'
const TOKEN = params.get('token') ?? import.meta.env.VITE_DBEEF_TOKEN ?? 'dev'

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response
  try {
    r = await fetch(ENGINE_URL + path, {
      ...init,
      headers: { 'X-DBeef-Token': TOKEN, 'Content-Type': 'application/json' },
    })
  } catch {
    throw new ApiError('engine_unreachable', `cannot reach the engine at ${ENGINE_URL}`)
  }
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new ApiError(body?.error?.code ?? 'internal', body?.error?.message ?? r.statusText)
  return body as T
}

const enc = encodeURIComponent
// Collection names may contain '/' (the engine route is {c:path}), so keep it unencoded.
const encPath = (s: string) => s.split('/').map(enc).join('/')
const store = (p: string, s: string) => `/api/projects/${enc(p)}/stores/${enc(s)}`

export const api = {
  projects: () => call<ProjectInfo[]>('/api/projects'),
  stores: (p: string) => call<StoreStatus[]>(`/api/projects/${enc(p)}/stores`),
  collections: (p: string, s: string) => call<Collection[]>(`${store(p, s)}/collections`),
  describe: (p: string, s: string, c: string) => call<Description>(`${store(p, s)}/collections/${encPath(c)}`),
  rows: (p: string, s: string, c: string, limit: number) =>
    call<QueryResult>(`${store(p, s)}/collections/${encPath(c)}/rows?limit=${limit}`),
  query: (p: string, s: string, text: string, limit: number) =>
    call<QueryResult>(`${store(p, s)}/query`, { method: 'POST', body: JSON.stringify({ text, limit }) }),
  schemaMap: (p: string) => call<SchemaMap>(`/api/projects/${enc(p)}/schema-map`),
}
