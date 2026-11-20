import { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '../types/mirofish';

interface Props {
  graph: KnowledgeGraph;
}

const NODE_TYPE_COLORS: Record<GraphNode['type'], { fill: string; stroke: string; label: string }> = {
  actor: { fill: '#1E293B', stroke: '#38BDF8', label: 'Actor' },
  catalyst: { fill: '#1E293B', stroke: '#10B981', label: 'Catalyst' },
  metric: { fill: '#1E293B', stroke: '#A78BFA', label: 'Metric' },
  institution: { fill: '#1E293B', stroke: '#F59E0B', label: 'Institution' },
  risk: { fill: '#1E293B', stroke: '#F43F5E', label: 'Risk' },
  outcome: { fill: '#0F172A', stroke: '#E2E8F0', label: 'Outcome' },
};

export function KnowledgeGraphCanvas({ graph }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    graph.nodes[0]?.id ?? null
  );
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [zoom, setZoom] = useState<number>(1);

  const visibleNodes = useMemo(() => {
    if (typeFilter === 'all') return graph.nodes;
    return graph.nodes.filter((n) => n.type === typeFilter);
  }, [graph.nodes, typeFilter]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const count = visibleNodes.length || 1;
    const cx = 420;
    const cy = 230;
    visibleNodes.forEach((node, idx) => {
      if (idx === 0 && count > 4) {
        map.set(node.id, { x: cx, y: cy });
        return;
      }
      const ringIndex = count > 4 ? idx - 1 : idx;
      const ringTotal = count > 4 ? count - 1 : count;
      const angle = (ringIndex / ringTotal) * Math.PI * 2 - Math.PI / 2;
      const rx = idx % 2 === 0 ? 255 : 175;
      const ry = idx % 2 === 0 ? 155 : 112;
      map.set(node.id, {
        x: Math.round(cx + Math.cos(angle) * rx),
        y: Math.round(cy + Math.sin(angle) * ry),
      });
    });
    return map;
  }, [visibleNodes]);

  const visibleEdges = useMemo(() => {
    const nodeIds = new Set(visibleNodes.map((n) => n.id));
    return graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [graph.edges, visibleNodes]);

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? visibleNodes[0] ?? null,
    [graph.nodes, selectedNodeId, visibleNodes]
  );

  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return graph.edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id
    );
  }, [graph.edges, selectedNode]);

  const nodeLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    graph.nodes.forEach((n) => map.set(n.id, n.label));
    return map;
  }, [graph.nodes]);

  const edgeStroke = (polarity: GraphEdge['polarity']) => {
    if (polarity === 'positive') return 'rgba(16, 185, 129, 0.45)';
    if (polarity === 'negative') return 'rgba(244, 63, 94, 0.45)';
    return 'rgba(148, 163, 184, 0.28)';
  };

  return (
    <div className="border border-slate-800/80 bg-[#111827] rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
        <div className="flex items-center gap-1 bg-[#0B0F17] p-1 rounded-md border border-slate-800/80">
          {['all', 'actor', 'catalyst', 'metric', 'risk', 'outcome'].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setTypeFilter(type)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 capitalize ${
                typeFilter === type
                  ? 'bg-[#1E293B] text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
            className="p-1.5 rounded border border-slate-800 text-slate-300 hover:bg-slate-800 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="font-mono-tabular text-xs text-slate-400 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.15).toFixed(2))))}
            className="p-1.5 rounded border border-slate-800 text-slate-300 hover:bg-slate-800 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="p-1.5 rounded border border-slate-800 text-slate-300 hover:bg-slate-800 transition-colors"
            title="Reset zoom"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Canvas + Inspector Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-8 bg-[#0B0F17] relative overflow-auto min-h-[380px]">
          <svg
            viewBox="0 0 840 460"
            className="w-full h-[380px] select-none"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
              transition: 'transform 150ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <defs>
              <marker
                id="arrow-neutral"
                viewBox="0 0 10 10"
                refX="18"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="rgba(148,163,184,0.45)" />
              </marker>
            </defs>

            {/* Subtle grid lines */}
            <g stroke="rgba(148,163,184,0.05)" strokeWidth="1">
              {[120, 240, 360, 480, 600, 720].map((x) => (
                <line key={`vx-${x}`} x1={x} y1={0} x2={x} y2={460} />
              ))}
              {[90, 180, 270, 360].map((y) => (
                <line key={`hy-${y}`} x1={0} y1={y} x2={840} y2={y} />
              ))}
            </g>

            {/* Edges */}
            {visibleEdges.map((edge, idx) => {
              const p1 = positions.get(edge.source);
              const p2 = positions.get(edge.target);
              if (!p1 || !p2) return null;
              const isHighlighted =
                selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id);
              const mx = (p1.x + p2.x) / 2;
              const my = (p1.y + p2.y) / 2;
              return (
                <g key={`edge-${idx}`}>
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={isHighlighted ? '#38BDF8' : edgeStroke(edge.polarity)}
                    strokeWidth={isHighlighted ? 2 : 1.25}
                    markerEnd="url(#arrow-neutral)"
                  />
                  {isHighlighted && (
                    <text
                      x={mx}
                      y={my - 5}
                      textAnchor="middle"
                      fill="#CBD5E1"
                      fontSize="10"
                      className="font-sans"
                    >
                      {edge.relation}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {visibleNodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              const palette = NODE_TYPE_COLORS[node.type] ?? NODE_TYPE_COLORS.actor;
              const isSelected = selectedNode?.id === node.id;
              const radius = 14 + Math.min(10, Math.max(2, node.weight));
              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={radius + (isSelected ? 4 : 0)}
                    fill={palette.fill}
                    stroke={isSelected ? '#38BDF8' : palette.stroke}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                  />
                  <text
                    x={pos.x}
                    y={pos.y + 4}
                    textAnchor="middle"
                    fill="#F1F5F9"
                    fontSize="10"
                    className="font-mono-tabular font-semibold pointer-events-none"
                  >
                    {node.weight}
                  </text>
                  <text
                    x={pos.x}
                    y={pos.y + radius + 16}
                    textAnchor="middle"
                    fill={isSelected ? '#38BDF8' : '#E2E8F0'}
                    fontSize="11.5"
                    fontWeight={isSelected ? '600' : '500'}
                    className="pointer-events-none"
                  >
                    {node.label.length > 22 ? `${node.label.slice(0, 20)}...` : node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Node Inspector */}
        <div className="lg:col-span-4 border-t lg:border-t-0 lg:border-l border-slate-800/80 p-5 flex flex-col justify-between gap-4">
          {selectedNode ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <span className="capitalize">{selectedNode.type}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">Weight {selectedNode.weight}/10</span>
                </div>
                <h4 className="text-base font-semibold text-slate-100 mt-1">
                  {selectedNode.label}
                </h4>
                <p className="text-sm text-slate-300 leading-relaxed mt-2">
                  {selectedNode.summary}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800/80">
                <div className="text-xs font-medium text-slate-400 mb-2">
                  Causal Connections ({connectedEdges.length})
                </div>
                {connectedEdges.length === 0 ? (
                  <p className="text-xs text-slate-500">No direct edges recorded.</p>
                ) : (
                  <ul className="space-y-2 max-h-[175px] overflow-y-auto pr-1">
                    {connectedEdges.map((e, i) => {
                      const isOutgoing = e.source === selectedNode.id;
                      const peerId = isOutgoing ? e.target : e.source;
                      const peerName = nodeLabelMap.get(peerId) || peerId;
                      return (
                        <li
                          key={i}
                          className="text-xs text-slate-300 flex items-start justify-between gap-2 pb-2 border-b border-slate-800/50 last:border-b-0"
                        >
                          <span>
                            {isOutgoing ? 'Impacts ' : 'Driven by '}
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(peerId)}
                              className="text-sky-400 hover:underline font-medium"
                            >
                              {peerName}
                            </button>{' '}
                            via {e.relation}
                          </span>
                          <span
                            className={`font-mono-tabular shrink-0 capitalize ${
                              e.polarity === 'positive'
                                ? 'text-emerald-400'
                                : e.polarity === 'negative'
                                  ? 'text-rose-400'
                                  : 'text-slate-400'
                            }`}
                          >
                            {e.polarity}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-400">Select any entity node to inspect its causal links.</div>
          )}

          <div className="pt-3 border-t border-slate-800/80 text-xs text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{graph.nodes.length} Entities</span>
            <span aria-hidden="true">·</span>
            <span>{graph.edges.length} Causal Edges</span>
          </div>
        </div>
      </div>
    </div>
  );
}
