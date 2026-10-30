import React, { useId, useState } from 'react';
import { area as d3area, line as d3line, curveMonotoneX } from 'd3-shape';
import { money, moneyRound } from './ui.tsx';
import { formatShort } from './logic/dates.ts';
import type { Sankey } from './logic/sankey.ts';

export interface Pt { date: string; value: number }

/** Área con relleno suave al 15 % bajo la línea y línea base discontinua. Táctil: arrastrar muestra el valor. */
export function AreaChart({ points, height = 160, color = 'var(--color-chart-1)', label, format = (v: number) => money(v), baseline = true }: { points: Pt[]; height?: number; color?: string; label: string; format?: (v: number) => string; baseline?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const W = 340, H = height, PAD = 6;
  if (points.length < 2) return <div className="muted sm" style={{ height }}>Aún no hay datos para dibujar el gráfico.</div>;
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - (lo - span * 0.1)) / (span * 1.2)) * (H - 2 * PAD);
  const ln = d3line<Pt>().x((_, i) => x(i)).y((p) => y(p.value)).curve(curveMonotoneX)(points)!;
  const ar = d3area<Pt>().x((_, i) => x(i)).y0(H - PAD).y1((p) => y(p.value)).curve(curveMonotoneX)(points)!;
  const first = points[0], last = points[points.length - 1];
  const summary = `${label}. De ${format(first.value)} el ${formatShort(first.date)} a ${format(last.value)} el ${formatShort(last.date)}. Mínimo ${format(Math.min(...vals))}, máximo ${format(Math.max(...vals))}.`;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width * W - PAD) / (W - 2 * PAD) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const h = hover !== null ? points[hover] : null;
  return (
    <figure className="chartwrap" style={{ margin: 0 }}>
      <div className="xs muted num" style={{ minHeight: 16 }} aria-hidden="true">{h ? `${formatShort(h.date)} · ${format(h.value)}` : ''}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label={summary} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: 'pan-y', display: 'block' }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0.02" /></linearGradient></defs>
        {baseline ? <line x1={PAD} x2={W - PAD} y1={y(first.value)} y2={y(first.value)} stroke="var(--color-border-input)" strokeDasharray="3 4" strokeWidth="1" /> : null}
        <path d={ar} fill={`url(#${id})`} />
        <path d={ln} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {h ? <line x1={x(hover!)} x2={x(hover!)} y1={PAD} y2={H - PAD} stroke="var(--color-border-input)" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
    </figure>
  );
}

export function Sparkline({ values, width = 64, height = 24, color = 'var(--color-text-muted)' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true"><line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="var(--color-border-input)" strokeDasharray="3 3" /></svg>;
  const lo = Math.min(...values), hi = Math.max(...values), s = hi - lo || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * width},${height - 2 - ((v - lo) / s) * (height - 4)}`).join('');
  return <svg width={width} height={height} aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

export interface FlowMonth { month: string; label: string; income: number; expenses: number }
/** Barras por mes: ingresos arriba, gastos abajo, línea de ahorro neto. El mes elegido va con borde. */
export function FlowChart({ data, selected, onSelect }: { data: FlowMonth[]; selected: string; onSelect: (m: string) => void }) {
  const W = 340, H = 180, PAD = 8, top = 10, bot = 24;
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, Math.abs(d.expenses))));
  const mid = top + (H - top - bot) / 2, half = (H - top - bot) / 2 - 4;
  const bw = (W - 2 * PAD) / data.length;
  const net = data.map((d, i) => ({ x: PAD + bw * i + bw / 2, y: mid - ((d.income + d.expenses) / max) * half }));
  const path = net.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
  const sel = data.find((d) => d.month === selected);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label={`Ingresos y gastos por mes. ${sel ? `Seleccionado ${sel.label}: ingresos ${money(sel.income)}, gastos ${money(Math.abs(sel.expenses))}.` : ''}`} style={{ display: 'block' }}>
      <line x1={PAD} x2={W - PAD} y1={mid} y2={mid} stroke="var(--color-border-input)" strokeWidth="1" />
      {data.map((d, i) => {
        const x0 = PAD + bw * i + bw * 0.18, w = bw * 0.64;
        const hi = (d.income / max) * half, he = (Math.abs(d.expenses) / max) * half;
        const isSel = d.month === selected;
        return (
          <g key={d.month} role="button" tabIndex={0} aria-label={`${d.label}: ingresos ${money(d.income)}, gastos ${money(Math.abs(d.expenses))}`} aria-pressed={isSel} onClick={() => onSelect(d.month)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(d.month); } }} style={{ cursor: 'pointer', outline: 'none' }}>
            <rect x={PAD + bw * i} y={0} width={bw} height={H} fill="transparent" />
            <rect x={x0} y={mid - hi} width={w} height={hi} rx="2" fill="var(--color-success)" opacity={isSel ? 1 : 0.35} />
            <rect x={x0} y={mid} width={w} height={he} rx="2" fill="var(--color-danger)" opacity={isSel ? 1 : 0.35} />
            <text x={PAD + bw * i + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fontWeight={isSel ? 700 : 400} fill={isSel ? 'var(--color-text)' : 'var(--color-text-muted)'}>{d.label}</text>
            {isSel ? <rect x={PAD + bw * i + 1} y={1} width={bw - 2} height={H - 2} rx="6" fill="none" stroke="var(--color-accent)" strokeWidth="2" /> : null}
          </g>
        );
      })}
      <path d={path} fill="none" stroke="var(--color-text)" strokeWidth="1.5" />
    </svg>
  );
}

export function StackedBar({ parts, total }: { parts: { label: string; cents: number; color: string }[]; total: number }) {
  return (
    <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }} role="img" aria-label={parts.map((p) => `${p.label} ${total ? Math.round((Math.abs(p.cents) / total) * 100) : 0} %`).join(', ')}>
      {parts.filter((p) => p.cents !== 0).map((p) => <span key={p.label} style={{ width: `${(Math.abs(p.cents) / (total || 1)) * 100}%`, background: p.color }} />)}
    </div>
  );
}
export const CHART_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--color-chart-${n})`);
export { moneyRound };

/** Diagrama de flujo (Sankey). Ancho fijo con desplazamiento horizontal en pantallas estrechas; las etiquetas llevan un halo para leerse sobre los flujos. */
export function SankeyChart({ sk }: { sk: Sankey }) {
  const pct = (c: number) => `${((c / sk.total) * 100).toFixed(1).replace('.', ',')} %`;
  const byId = new Map(sk.nodes.map((n) => [n.id, n]));
  const halo = { paintOrder: 'stroke', stroke: 'var(--color-surface)', strokeWidth: 3, strokeLinejoin: 'round' } as const;
  return (
    <div className="sankey" tabIndex={0} role="group" aria-label="Diagrama de flujo: desplázalo en horizontal si no cabe">
      <svg viewBox={`0 0 ${sk.width} ${sk.height}`} width={sk.width} height={sk.height} role="img" aria-label={`Ingresos ${money(sk.totalIn)}, gastos ${money(sk.totalOut)}, ${sk.net >= 0 ? 'ahorro' : 'déficit'} ${money(Math.abs(sk.net))}`} style={{ display: 'block' }}>
        <g>{sk.links.map((l) => {
          const a = byId.get(l.source)!, b = byId.get(l.target)!;
          const x0 = a.x + sk.nodeW, x1 = b.x, xm = (x0 + x1) / 2;
          return <path key={l.source + l.target} d={`M${x0},${l.sy} C${xm},${l.sy} ${xm},${l.ty} ${x1},${l.ty} L${x1},${l.ty + l.w} C${xm},${l.ty + l.w} ${xm},${l.sy + l.w} ${x0},${l.sy + l.w} Z`} fill={l.color} opacity="0.28"><title>{`${a.label} → ${b.label}: ${money(l.cents)}`}</title></path>;
        })}</g>
        {sk.nodes.map((n) => {
          // columna 0: etiqueta a la derecha y arriba; resto: a la izquierda de su barra, para que no se pisen entre columnas
          const left = n.col >= 1, tx = left ? n.x - 8 : n.x + sk.nodeW + 8, two = n.h >= 30, show = n.h >= 14;
          const cy = n.col === 0 && two ? n.y + 16 : n.y + n.h / 2;
          return (
            <g key={n.id}>
              <rect x={n.x} y={n.y} width={sk.nodeW} height={n.h} rx="2" fill={n.color}><title>{`${n.label}: ${money(n.cents)} (${pct(n.cents)})`}</title></rect>
              {show ? (
                <text x={tx} y={two ? cy - 2 : cy + 4} textAnchor={left ? 'end' : 'start'} fontSize="12" fill="var(--color-text)" style={halo}>
                  {two ? <><tspan x={tx} fontWeight={600}>{n.label}</tspan><tspan x={tx} dy="15">{money(n.cents)} ({pct(n.cents)})</tspan></> : `${n.label} · ${money(n.cents)}`}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
