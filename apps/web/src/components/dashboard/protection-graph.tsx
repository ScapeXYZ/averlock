"use client";

import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { GraphNode, GraphNodeId } from "@/lib/averlock/types";
import { Icon } from "./icons";

const iconName: Record<GraphNodeId, string> = { payment: "wallet", fdc: "proof", ftso: "price", fcc: "lock", decision: "decision", vault: "vault" };

export function ProtectionGraph({ nodes, selected, onSelect }: { nodes: GraphNode[]; selected: GraphNodeId; onSelect: (id: GraphNodeId) => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const index = useMemo(() => nodes.findIndex((node) => node.id === selected), [nodes, selected]);
  const clamp = (value: number) => Math.min(1.35, Math.max(.78, value));
  const onWheel = (event: WheelEvent) => { event.preventDefault(); setZoom((value) => clamp(value - event.deltaY * .001)); };
  const onPointerDown = (event: PointerEvent) => { if ((event.target as HTMLElement).closest("button")) return; drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); };
  const onPointerMove = (event: PointerEvent) => { if (!drag.current) return; setPan({ x: drag.current.px + event.clientX - drag.current.x, y: drag.current.py + event.clientY - drag.current.y }); };
  const onKeyDown = (event: React.KeyboardEvent) => { if (!["ArrowRight", "ArrowLeft"].includes(event.key)) return; event.preventDefault(); const next = event.key === "ArrowRight" ? Math.min(nodes.length - 1, index + 1) : Math.max(0, index - 1); onSelect(nodes[next].id); document.getElementById(`graph-${nodes[next].id}`)?.focus(); };
  return <div className="graph-shell">
    <div className="graph-toolbar" aria-label="Graph controls"><button onClick={() => setZoom((v) => clamp(v + .1))} aria-label="Zoom in"><Icon name="zoomin"/></button><button onClick={() => setZoom((v) => clamp(v - .1))} aria-label="Zoom out"><Icon name="zoomout"/></button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Reset view"><Icon name="reset"/></button><span>{Math.round(zoom * 100)}%</span></div>
    <div className="graph-viewport" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }}>
      <div className="graph-canvas" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} onKeyDown={onKeyDown}>
        {nodes.map((node, nodeIndex) => <div className="graph-segment" key={node.id}>
          <button id={`graph-${node.id}`} className={`graph-node ${node.state} ${selected === node.id ? "selected" : ""}`} onClick={() => onSelect(node.id)} aria-pressed={selected === node.id}>
            <span className="node-status"><Icon name="check"/></span><span className="node-icon"><Icon name={iconName[node.id]}/></span><span className="node-copy"><small>{node.eyebrow}</small><strong>{node.title}</strong>{node.metric && <em>{node.metric}</em>}</span>
          </button>
          {nodeIndex < nodes.length - 1 && <div className={`graph-edge ${nodes[nodeIndex + 1].state !== "pending" ? "complete" : ""}`}><span/><Icon name="arrow"/></div>}
        </div>)}
      </div>
    </div>
  </div>;
}
