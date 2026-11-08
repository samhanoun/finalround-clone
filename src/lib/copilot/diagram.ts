/**
 * Diagrams for system-design answers. The model writes a fenced ```diagram
 * block with one connection per line ("Client -> API gateway: HTTPS"), and
 * the answer window draws it as boxes and arrows in layers, left to right.
 * A tiny format the model gets right, drawn without a diagram library.
 */

export type DiagramEdge = { from: string; to: string; label: string };
export type DiagramNode = { id: string; label: string; layer: number; row: number };
export type DiagramLayout = { nodes: DiagramNode[]; edges: DiagramEdge[]; layers: number; rows: number };

const MAX_NODES = 16;
const MAX_EDGES = 24;

export function parseDiagram(source: string): DiagramEdge[] {
  const edges: DiagramEdge[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.replace(/^[-*\s]+/, '').trim();
    const match = /^(.+?)\s*(?:-->|->|→|=>)\s*(.+?)(?:\s*:\s*(.+))?$/.exec(line);
    if (!match) continue;
    const from = match[1].replace(/[[\]()"]/g, '').trim().slice(0, 40);
    const to = match[2].replace(/[[\]()"]/g, '').trim().slice(0, 40);
    if (!from || !to || from === to) continue;
    edges.push({ from, to, label: (match[3] ?? '').trim().slice(0, 32) });
    if (edges.length >= MAX_EDGES) break;
  }
  return edges;
}

/** Layers by longest path from the sources (cycles are broken where they're found). */
export function layoutDiagram(edges: DiagramEdge[]): DiagramLayout {
  const names: string[] = [];
  for (const edge of edges) {
    for (const name of [edge.from, edge.to]) if (!names.includes(name) && names.length < MAX_NODES) names.push(name);
  }
  const kept = edges.filter((edge) => names.includes(edge.from) && names.includes(edge.to));
  const layer = new Map<string, number>(names.map((name) => [name, 0]));
  // Relax edges a bounded number of times: enough for any DAG of this size, and it stops on cycles.
  for (let pass = 0; pass < names.length; pass += 1) {
    let changed = false;
    for (const edge of kept) {
      const next = (layer.get(edge.from) ?? 0) + 1;
      if (next > (layer.get(edge.to) ?? 0) && next < names.length) {
        layer.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rowsUsed = new Map<number, number>();
  const nodes = names.map((name) => {
    const l = layer.get(name) ?? 0;
    const row = rowsUsed.get(l) ?? 0;
    rowsUsed.set(l, row + 1);
    return { id: name, label: name, layer: l, row };
  });
  return {
    nodes,
    edges: kept,
    layers: Math.max(0, ...nodes.map((node) => node.layer)) + 1,
    rows: Math.max(1, ...rowsUsed.values()),
  };
}
