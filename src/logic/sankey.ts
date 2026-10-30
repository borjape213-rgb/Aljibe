import type { Id, State } from './types.ts';
import { catIndex, effectiveParts } from './ledger.ts';

/**
 * Diagrama de flujo (Sankey) de un periodo: de dónde viene el dinero → total de ingresos → grupos de gasto (y ahorro) → categorías.
 * Mismo criterio que `cashFlow`: sin traspasos ni ocultas, y cada parte cuenta como ingreso si es positiva y como gasto si es negativa.
 * Si se gasta más de lo que entra, aparece un origen «Déficit» para que los flujos cuadren.
 */
export type SankeyKind = 'income' | 'deficit' | 'total' | 'saving' | 'group' | 'category';
export interface SNode { id: string; label: string; col: 0 | 1 | 2 | 3; kind: SankeyKind; cents: number; color: string; x: number; y: number; h: number }
export interface SLink { source: string; target: string; cents: number; color: string; w: number; sy: number; ty: number }
export interface Sankey { nodes: SNode[]; links: SLink[]; total: number; totalIn: number; totalOut: number; net: number; width: number; height: number; nodeW: number }

export interface SankeyOptions { width?: number; height?: number; gap?: number; minH?: number; minShare?: number }

const GREEN = 'var(--color-success)', RED = 'var(--color-danger)';
const chart = (i: number) => `var(--color-chart-${(i % 8) + 1})`;

export function buildSankey(s: State, from: string, to: string, opt: SankeyOptions = {}): Sankey {
  const width = opt.width ?? 480, H = opt.height ?? 420, gap = opt.gap ?? 8, minH = opt.minH ?? 3, minShare = opt.minShare ?? 0.015, nodeW = 10;
  const { cats, groups, kindOf } = catIndex(s);
  const inc = new Map<Id, number>(), exp = new Map<Id, number>();
  for (const t of s.transactions) {
    if (t.hidden || t.date < from || t.date > to) continue;
    for (const p of effectiveParts(t)) {
      if (kindOf(p.categoryId) === 'transfer' || p.amountCents === 0) continue;
      const target = p.amountCents > 0 ? inc : exp;
      target.set(p.categoryId, (target.get(p.categoryId) ?? 0) + Math.abs(p.amountCents));
    }
  }
  const totalIn = [...inc.values()].reduce((a, b) => a + b, 0), totalOut = [...exp.values()].reduce((a, b) => a + b, 0);
  const empty: Sankey = { nodes: [], links: [], total: 0, totalIn, totalOut, net: totalIn - totalOut, width, height: 0, nodeW };
  if (totalIn === 0 && totalOut === 0) return empty;
  const total = Math.max(totalIn, totalOut), net = totalIn - totalOut, small = total * minShare;
  const name = (id: Id) => cats.get(id)?.name ?? 'Sin categoría';

  const nodes: SNode[] = [], links: SLink[] = [];
  const node = (id: string, label: string, col: SNode['col'], kind: SankeyKind, cents: number, color: string) => nodes.push({ id, label, col, kind, cents, color, x: 0, y: 0, h: 0 });
  const link = (source: string, target: string, cents: number, color: string) => links.push({ source, target, cents, color, w: 0, sy: 0, ty: 0 });
  /** Agrupa las partidas pequeñas en una sola «Otros» (solo si son al menos dos). */
  const merged = (rows: { id: string; label: string; cents: number }[], otherLabel: string) => {
    const sorted = [...rows].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
    const tiny = sorted.filter((r) => r.cents < small);
    if (tiny.length < 2) return sorted;
    return [...sorted.filter((r) => r.cents >= small), { id: 'other', label: otherLabel, cents: tiny.reduce((n, r) => n + r.cents, 0) }];
  };

  // columna 0 → 1: de dónde entra el dinero
  node('total', 'Ingresos', 1, 'total', total, GREEN);
  for (const r of merged([...inc].map(([id, cents]) => ({ id, label: name(id), cents })), 'Otros ingresos')) {
    node(`in:${r.id}`, r.label, 0, 'income', r.cents, GREEN); link(`in:${r.id}`, 'total', r.cents, GREEN);
  }
  if (totalOut > totalIn) { node('deficit', 'Déficit (gastado de más)', 0, 'deficit', totalOut - totalIn, RED); link('deficit', 'total', totalOut - totalIn, RED); }

  // columna 1 → 2 → 3: adónde va
  if (net > 0) { node('saving', 'Ahorro', 2, 'saving', net, GREEN); link('total', 'saving', net, GREEN); }
  const byGroup = new Map<Id, { id: string; label: string; cents: number }[]>();
  for (const [id, cents] of exp) {
    const gid = cats.get(id)?.groupId ?? '';
    byGroup.set(gid, [...(byGroup.get(gid) ?? []), { id, label: name(id), cents }]);
  }
  const groupRows = [...byGroup].map(([gid, rows]) => ({ gid, label: groups.get(gid)?.name ?? 'Sin grupo', rows, cents: rows.reduce((n, r) => n + r.cents, 0) })).sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
  groupRows.forEach((g, i) => {
    const color = chart(i);
    node(`g:${g.gid}`, g.label, 2, 'group', g.cents, color); link('total', `g:${g.gid}`, g.cents, color);
    for (const r of merged(g.rows, `Otros (${g.label})`)) { node(`c:${g.gid}:${r.id}`, r.label, 3, 'category', r.cents, color); link(`g:${g.gid}`, `c:${g.gid}:${r.id}`, r.cents, color); }
  });

  // tamaño: una misma escala para todas las columnas, la que quepa en la altura dada
  const cols = [0, 1, 2, 3].map((c) => nodes.filter((n) => n.col === c));
  const k = Math.min(...cols.filter((c) => c.length).map((c) => (H - gap * (c.length - 1)) / c.reduce((n, x) => n + x.cents, 0)));
  const xs = [0, (width - nodeW) * 0.3, (width - nodeW) * 0.6, width - nodeW];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) { n.h = Math.max(minH, n.cents * k); n.x = xs[n.col]; }
  for (const c of [0, 1, 2]) { let y = 0; for (const n of cols[c]) { n.y = y; y += n.h + gap; } }
  // las categorías se alinean con su grupo siempre que haya sitio
  let y = 0;
  for (const n of cols[3]) {
    const parent = byId.get(links.find((l) => l.target === n.id)!.source)!;
    n.y = Math.max(y, parent.y); y = n.y + n.h + gap;
  }
  // flujos: cada uno ocupa su tramo dentro del nodo, ordenados para que no se crucen de más
  for (const n of nodes) {
    let o = n.y;
    for (const l of links.filter((l) => l.source === n.id).sort((a, b) => byId.get(a.target)!.y - byId.get(b.target)!.y)) { l.w = l.cents * k; l.sy = o; o += l.w; }
    let i = n.y;
    for (const l of links.filter((l) => l.target === n.id).sort((a, b) => byId.get(a.source)!.y - byId.get(b.source)!.y)) { l.w = l.cents * k; l.ty = i; i += l.w; }
  }
  const height = Math.ceil(Math.max(...nodes.map((n) => n.y + n.h))) + 2;
  return { nodes, links, total, totalIn, totalOut, net, width, height, nodeW };
}
