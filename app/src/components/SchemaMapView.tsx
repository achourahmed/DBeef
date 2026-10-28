import { useEffect, useState } from 'react'
import {
  Background, Controls, Handle, MarkerType, Panel, Position, ReactFlow,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ELK from 'elkjs/lib/elk.bundled.js'
import { api, type MapEdge, type MapNode, type SchemaMap } from '@/api/client'
import { useLoad } from '@/api/useLoad'
import { ErrorNote } from './ErrorNote'
import type { Selection } from './Sidebar'

const elk = new ELK()
const WIDTH = 230
const MAX_FIELDS = 8

// One style per edge kind; the legend reads from the same table.
const EDGE_STYLE: Record<MapEdge['kind'], { stroke: string; dash?: string; width: number; label: string }> = {
  intra: { stroke: '#8a8a8a', width: 1.2, label: 'inside a store (foreign key, relationship)' },
  cross: { stroke: '#F0444B', width: 2.2, label: 'cross-store link (from dbeef.yaml)' },
  suggested: { stroke: '#6b8fd6', dash: '5 4', width: 1.4, label: 'suggested (shared field name)' },
  broken: { stroke: '#d97706', dash: '2 3', width: 2, label: 'broken link (missing end)' },
}

type NodeData = { node: MapNode | null; id: string }

const height = (n: MapNode | null) => (n ? 44 + Math.min(n.fields.length, MAX_FIELDS + 1) * 18 : 56)

function CollectionNode({ data }: NodeProps<Node<NodeData>>) {
  const n = data.node
  const handles = (
    <>
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </>
  )
  if (!n) {
    return (
      <div style={{ width: WIDTH }} className="rounded-md border-2 border-dashed border-amber-600 bg-amber-50 p-2 text-xs dark:bg-amber-950">
        {handles}
        <p className="font-medium text-amber-700 dark:text-amber-400">missing</p>
        <p className="truncate font-mono">{data.id}</p>
      </div>
    )
  }
  const extra = n.fields.length - MAX_FIELDS
  return (
    <div style={{ width: WIDTH }} className="bg-card text-card-foreground cursor-pointer rounded-md border shadow-sm hover:ring-2 hover:ring-[#F0444B]/40">
      {handles}
      <div className="border-b px-2.5 py-1.5">
        <div className="text-muted-foreground flex justify-between text-[10px] uppercase">
          <span className="truncate">{n.store} · {n.store_type}</span>
          <span>{n.kind.replace('_', ' ')}</span>
        </div>
        <div className="flex justify-between gap-2 font-mono text-xs font-semibold">
          <span className="truncate">{n.collection}</span>
          {n.count !== null && <span className="text-muted-foreground font-normal tabular-nums">{n.count.toLocaleString()}</span>}
        </div>
      </div>
      <ul className="px-2.5 py-1 font-mono text-[11px] leading-[18px]">
        {n.fields.slice(0, MAX_FIELDS).map((f) => (
          <li key={f.name} className="flex justify-between gap-2">
            <span className="truncate">{f.name}</span>
            <span className="text-muted-foreground truncate">{f.type}</span>
          </li>
        ))}
        {extra > 0 && <li className="text-muted-foreground">+{extra} more</li>}
      </ul>
    </div>
  )
}

const nodeTypes = { collection: CollectionNode }

async function toFlow(map: SchemaMap): Promise<{ nodes: Node<NodeData>[]; edges: Edge[] }> {
  const byId = new Map<string, MapNode | null>(map.nodes.map((n) => [n.id, n]))
  // A broken link can point at a collection that doesn't exist: draw a placeholder for it.
  for (const e of map.edges) for (const id of [e.from, e.to]) if (!byId.has(id)) byId.set(id, null)

  const edges: Edge[] = map.edges.map((e, i) => {
    const s = EDGE_STYLE[e.kind]
    return {
      id: `e${i}`,
      source: e.from,
      target: e.to,
      label: e.label,
      labelStyle: { fontSize: 10, fill: s.stroke },
      labelBgStyle: { fillOpacity: 0.85 },
      style: { stroke: s.stroke, strokeWidth: s.width, strokeDasharray: s.dash },
      markerEnd: e.kind === 'suggested' ? undefined : { type: MarkerType.ArrowClosed, color: s.stroke },
    }
  })

  const g = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    },
    children: [...byId].map(([id, n]) => ({ id, width: WIDTH, height: height(n) })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  })
  const nodes = (g.children ?? []).map((c) => ({
    id: c.id,
    type: 'collection',
    position: { x: c.x ?? 0, y: c.y ?? 0 },
    data: { node: byId.get(c.id) ?? null, id: c.id },
  }))
  return { nodes, edges }
}

export function SchemaMapView({ project, onSelect }: { project: string; onSelect: (s: Selection) => void }) {
  const map = useLoad(() => api.schemaMap(project), [project])
  // Keeps the map it was laid out from, so a project switch never shows the old layout.
  const [flow, setFlow] = useState<{ src: SchemaMap; nodes: Node<NodeData>[]; edges: Edge[] } | null>(null)
  const dark = matchMedia('(prefers-color-scheme: dark)').matches

  useEffect(() => {
    const src = map.data
    if (src) toFlow(src).then((f) => setFlow({ src, ...f }))
  }, [map.data])

  if (map.error) return <div className="p-6"><ErrorNote error={map.error} /></div>
  if (!flow || flow.src !== map.data) return <p className="text-muted-foreground p-6 text-sm">laying out the map…</p>
  return (
    <ReactFlow
      nodes={flow.nodes}
      edges={flow.edges}
      nodeTypes={nodeTypes}
      colorMode={dark ? 'dark' : 'light'}
      nodesConnectable={false}
      fitView
      minZoom={0.1}
      onNodeClick={(_, n) => {
        const node = (n.data as NodeData).node
        if (node) onSelect({ store: node.store, collection: node.collection })
      }}
    >
      <Background />
      <Controls showInteractive={false} />
      <Panel position="top-left">
        <div className="bg-card/90 space-y-1 rounded-md border p-2 text-xs shadow-sm">
          {Object.entries(EDGE_STYLE).map(([kind, s]) => (
            <div key={kind} className="flex items-center gap-2">
              <svg width="28" height="6">
                <line x1="0" y1="3" x2="28" y2="3" stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} />
              </svg>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </Panel>
      {flow.src.errors.length > 0 && (
        <Panel position="top-right">
          <div className="bg-card/90 max-w-80 space-y-1 rounded-md border border-red-500/50 p-2 text-xs shadow-sm">
            {flow.src.errors.map((e) => (
              <p key={e.name} className="line-clamp-3" title={e.message ?? undefined}>
                <span className="font-medium text-red-600">{e.name}</span> unavailable: {e.message}
              </p>
            ))}
          </div>
        </Panel>
      )}
    </ReactFlow>
  )
}
