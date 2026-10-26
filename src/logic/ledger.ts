import type { Account, Category, CategoryGroup, Id, PricePoint, Split, State, Transaction } from './types.ts';
import { addDays, daysBetween, todayISO } from './dates.ts';

export const effectiveParts = (t: Transaction): Split[] =>
  t.splits.length ? t.splits : [{ categoryId: t.categoryId, amountCents: t.amountCents }];

export function catIndex(s: State) {
  const cats = new Map<Id, Category>(s.categories.map((c) => [c.id, c]));
  const groups = new Map<Id, CategoryGroup>(s.groups.map((g) => [g.id, g]));
  const kindOf = (catId: Id) => groups.get(cats.get(catId)?.groupId ?? '')?.kind ?? 'expense';
  return { cats, groups, kindOf };
}

/** Importes por categoría de las transacciones del rango [from, to] (inclusive), ya con divisiones. Sin traspasos ni ocultas. */
export function actualsByCategory(s: State, from: string, to: string): Map<Id, number> {
  const { kindOf } = catIndex(s);
  const out = new Map<Id, number>();
  for (const t of s.transactions) {
    if (t.hidden || t.date < from || t.date > to) continue;
    for (const p of effectiveParts(t)) {
      if (kindOf(p.categoryId) === 'transfer') continue;
      out.set(p.categoryId, (out.get(p.categoryId) ?? 0) + p.amountCents);
    }
  }
  return out;
}

/** Último precio conocido hasta cada fecha, con arrastre hacia delante. */
export function priceLookup(series: PricePoint[] | undefined) {
  const m = new Map<string, number>();
  let first = 0;
  if (series?.length) first = series[0].price;
  for (const p of series ?? []) m.set(p.date, p.price);
  const sorted = series ?? [];
  return (date: string): number => {
    const direct = m.get(date);
    if (direct !== undefined) return direct;
    // búsqueda binaria del último punto <= date
    let lo = 0, hi = sorted.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].date <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? sorted[ans].price : first;
  };
}

export function holdingValueCents(s: State, h: { securityId: Id; quantity: number }, date: string, lookups = new Map<Id, (d: string) => number>()): number {
  let f = lookups.get(h.securityId);
  if (!f) { f = priceLookup(s.prices[h.securityId]); lookups.set(h.securityId, f); }
  return Math.round(h.quantity * f(date) * 100);
}

export function accountValueCents(s: State, a: Account, date = todayISO()): number {
  if (a.group === 'investments') return s.holdings.filter((h) => h.accountId === a.id).reduce((n, h) => n + holdingValueCents(s, h, date), 0);
  return a.balanceCents;
}

/** Saldo al cierre de cada día entre from y to. */
export function accountSeries(s: State, a: Account, from: string, to: string): { date: string; cents: number }[] {
  const days = daysBetween(from, to);
  const out: { date: string; cents: number }[] = [];
  if (days < 0) return out;
  if (a.group === 'investments') {
    const lookups = new Map<Id, (d: string) => number>();
    const hs = s.holdings.filter((h) => h.accountId === a.id);
    for (let i = 0; i <= days; i++) {
      const date = addDays(from, i);
      out.push({ date, cents: hs.reduce((n, h) => n + holdingValueCents(s, h, date, lookups), 0) });
    }
    return out;
  }
  if (a.valuations?.length) {
    const vals = [...a.valuations].sort((x, y) => (x.date < y.date ? -1 : 1));
    for (let i = 0; i <= days; i++) {
      const date = addDays(from, i);
      let cents = vals[0].cents;
      for (const v of vals) if (v.date <= date) cents = v.cents;
      out.push({ date, cents });
    }
    return out;
  }
  // saldo actual menos lo que se movió después de cada día
  const byDate = new Map<string, number>();
  for (const t of s.transactions) if (t.accountId === a.id) byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.amountCents);
  const today = todayISO();
  let bal = a.balanceCents;
  // retrocede desde hoy hasta `to`
  for (let d = today; d > to; d = addDays(d, -1)) bal -= byDate.get(d) ?? 0;
  const rev: { date: string; cents: number }[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    rev.push({ date: d, cents: bal });
    bal -= byDate.get(d) ?? 0;
  }
  return rev.reverse();
}

export interface NetWorthPoint { date: string; assets: number; liabilities: number; net: number }
export function netWorthSeries(s: State, from: string, to: string, includeHidden = false): NetWorthPoint[] {
  const accs = s.accounts.filter((a) => includeHidden || !a.hidden);
  const series = accs.map((a) => accountSeries(s, a, from, to));
  const n = daysBetween(from, to) + 1;
  if (!series.length) return Array.from({ length: Math.max(0, n) }, (_, i) => ({ date: addDays(from, i), assets: 0, liabilities: 0, net: 0 }));
  const out: NetWorthPoint[] = [];
  for (let i = 0; i < n; i++) {
    let assets = 0, liabilities = 0;
    series.forEach((ser) => {
      const c = ser[i].cents;
      if (c >= 0) assets += c; else liabilities += c;
    });
    out.push({ date: ser0(series, i), assets, liabilities, net: assets + liabilities });
  }
  return out;
}
const ser0 = (series: { date: string }[][], i: number) => series[0][i].date;

export const GROUP_LABEL: Record<Account['group'], string> = {
  cash: 'Efectivo', credit: 'Tarjetas de crédito', loans: 'Préstamos', investments: 'Inversiones', assets: 'Bienes', other: 'Otras',
};
export const GROUP_ORDER: Account['group'][] = ['cash', 'investments', 'assets', 'credit', 'loans', 'other'];

export function changeOver(series: { cents?: number; net?: number }[]): { delta: number; pct: number } {
  if (series.length < 2) return { delta: 0, pct: 0 };
  const get = (p: { cents?: number; net?: number }) => (p.cents ?? p.net ?? 0);
  const a = get(series[0]), b = get(series[series.length - 1]);
  const delta = b - a;
  const pct = a === 0 ? 0 : (delta / Math.abs(a)) * 100;
  return { delta, pct };
}

export interface CashFlowRow { key: string; label: string; cents: number }
export function cashFlow(s: State, from: string, to: string, by: 'category' | 'group' | 'merchant') {
  const { cats, groups, kindOf } = catIndex(s);
  const inc = new Map<string, CashFlowRow>(), exp = new Map<string, CashFlowRow>();
  for (const t of s.transactions) {
    if (t.hidden || t.date < from || t.date > to) continue;
    for (const p of effectiveParts(t)) {
      const kind = kindOf(p.categoryId);
      if (kind === 'transfer') continue;
      const cat = cats.get(p.categoryId);
      const key = by === 'category' ? p.categoryId : by === 'group' ? cat?.groupId ?? '' : t.merchant;
      const label = by === 'category' ? cat?.name ?? '—' : by === 'group' ? groups.get(cat?.groupId ?? '')?.name ?? '—' : t.merchant;
      const target = p.amountCents >= 0 ? inc : exp;
      const row = target.get(key) ?? { key, label, cents: 0 };
      row.cents += p.amountCents;
      target.set(key, row);
    }
  }
  const income = [...inc.values()].sort((a, b) => b.cents - a.cents);
  const expenses = [...exp.values()].sort((a, b) => a.cents - b.cents);
  const totalIn = income.reduce((n, r) => n + r.cents, 0), totalOut = expenses.reduce((n, r) => n + r.cents, 0);
  return { income, expenses, totalIn, totalOut, net: totalIn + totalOut };
}
