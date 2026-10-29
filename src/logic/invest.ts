import type { AssetClass, Holding, Id, PricePoint, State } from './types.ts';
import { holdingValueCents, priceLookup } from './ledger.ts';
import { addDays, todayISO } from './dates.ts';

export const CLASS_LABEL: Record<AssetClass, string> = { equity: 'Renta variable', bonds: 'Renta fija', cash: 'Efectivo', property: 'Inmuebles', crypto: 'Cripto', other: 'Otros' };
export const RANGES = [{ id: '1m', label: '1M', days: 30 }, { id: '3m', label: '3M', days: 91 }, { id: '6m', label: '6M', days: 182 }, { id: '1y', label: '1A', days: 365 }] as const;

export interface HoldingRow {
  holding: Holding;
  name: string;
  ticker: string;
  assetClass: AssetClass;
  valueCents: number;
  /** Rentabilidad de precio del periodo (%). */
  periodPct: number;
  gainCents: number | null;
  gainPct: number | null;
  /** Precio unitario actual. */
  unitPrice: number;
  /** Precio unitario medio de compra (coste total / cantidad), o null si no se indicó el coste. */
  unitCost: number | null;
}

export function holdingRows(s: State, accountIds: Id[] | null, days: number, today = todayISO()): HoldingRow[] {
  const from = addDays(today, -days);
  const rows: HoldingRow[] = [];
  for (const h of s.holdings) {
    if (accountIds && !accountIds.includes(h.accountId)) continue;
    const sec = s.securities.find((x) => x.id === h.securityId);
    if (!sec) continue;
    const f = priceLookup(s.prices[h.securityId]);
    const valueCents = Math.round(h.quantity * f(today) * 100);
    const p0 = f(from), p1 = f(today);
    rows.push({ holding: h, name: sec.name, ticker: sec.ticker, assetClass: sec.assetClass, valueCents, periodPct: p0 ? (p1 / p0 - 1) * 100 : 0, gainCents: h.costBasisCents === null ? null : valueCents - h.costBasisCents, gainPct: h.costBasisCents ? ((valueCents - h.costBasisCents) / h.costBasisCents) * 100 : null, unitPrice: f(today), unitCost: h.costBasisCents === null || !(h.quantity > 0) ? null : h.costBasisCents / 100 / h.quantity });
  }
  return rows.sort((a, b) => b.valueCents - a.valueCents);
}

/** Rentabilidad de precio de las posiciones actuales: Σ cant·(p1−p0) / Σ cant·p0. No incluye aportaciones ni dividendos. */
export function portfolioReturn(s: State, accountIds: Id[] | null, days: number, today = todayISO()): { pct: number; deltaCents: number; valueCents: number } {
  const from = addDays(today, -days);
  let v0 = 0, v1 = 0;
  const lookups = new Map<Id, (d: string) => number>();
  for (const h of s.holdings) {
    if (accountIds && !accountIds.includes(h.accountId)) continue;
    v0 += holdingValueCents(s, h, from, lookups);
    v1 += holdingValueCents(s, h, today, lookups);
  }
  return { pct: v0 ? (v1 / v0 - 1) * 100 : 0, deltaCents: v1 - v0, valueCents: v1 };
}

/** Serie en % desde el primer día del rango, para poder dibujar cartera e índices en el mismo eje. */
export function pctSeries(points: PricePoint[], days: number, today = todayISO()): { date: string; pct: number }[] {
  const from = addDays(today, -days);
  const f = priceLookup(points);
  const base = f(from);
  const out: { date: string; pct: number }[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) out.push({ date: d, pct: base ? (f(d) / base - 1) * 100 : 0 });
  return out;
}

export function portfolioPctSeries(s: State, accountIds: Id[] | null, days: number, today = todayISO()) {
  const from = addDays(today, -days);
  const lookups = new Map<Id, (d: string) => number>();
  const hs = s.holdings.filter((h) => !accountIds || accountIds.includes(h.accountId));
  const val = (d: string) => hs.reduce((n, h) => n + holdingValueCents(s, h, d, lookups), 0);
  const base = val(from);
  const out: { date: string; pct: number }[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) out.push({ date: d, pct: base ? (val(d) / base - 1) * 100 : 0 });
  return out;
}

export function allocation(rows: HoldingRow[]) {
  const m = new Map<AssetClass, number>();
  for (const r of rows) m.set(r.assetClass, (m.get(r.assetClass) ?? 0) + r.valueCents);
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return { total, parts: [...m.entries()].map(([cls, cents]) => ({ cls, label: CLASS_LABEL[cls], cents, pct: total ? (cents / total) * 100 : 0 })).sort((a, b) => b.cents - a.cents) };
}
