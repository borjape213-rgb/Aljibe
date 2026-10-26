import type { BudgetItem, Id, State } from './types.ts';
import { actualsByCategory, catIndex } from './ledger.ts';
import { addMonths, daysInMonth, monthStart, monthsBetween, todayISO } from './dates.ts';

export const budgetOf = (s: State, categoryId: Id, month: string) =>
  s.budgetItems.find((b) => b.categoryId === categoryId && b.month === month)?.amountCents ?? 0;

/** Gasto del mes en positivo (un reembolso lo reduce). */
export function spentOf(actuals: Map<Id, number>, categoryId: Id) {
  return -(actuals.get(categoryId) ?? 0);
}

export function monthRange(month: string) {
  return { from: month, to: `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

/** Saldo que arrastra la categoría desde meses anteriores. Cero si no hay arrastre. */
export function rolloverIn(s: State, categoryId: Id, month: string): number {
  const cfg = s.rollovers.find((r) => r.categoryId === categoryId && r.enabled);
  if (!cfg || month <= cfg.startMonth) return cfg && month === cfg.startMonth ? cfg.startingBalanceCents : 0;
  let bal = cfg.startingBalanceCents;
  for (const m of monthsBetween(cfg.startMonth, addMonths(month, -1))) {
    const { from, to } = monthRange(m);
    const spent = spentOf(actualsByCategory(s, from, to), categoryId);
    bal += budgetOf(s, categoryId, m) - spent;
  }
  return bal;
}

export interface BudgetRow {
  categoryId: Id;
  name: string;
  budget: number;
  spent: number;
  rollover: number;
  remaining: number;
  hasRollover: boolean;
}
export interface BucketSummary {
  bucket: 'fixed' | 'nonmonthly' | 'flexible';
  label: string;
  budget: number;
  spent: number;
  remaining: number;
  groups: { groupId: Id; name: string; rows: BudgetRow[]; budget: number; spent: number; remaining: number }[];
}
export const BUCKET_LABEL = { fixed: 'Fijos', nonmonthly: 'No mensuales', flexible: 'Flexibles' } as const;

export function budgetSummary(s: State, month: string) {
  const { from, to } = monthRange(month);
  const actuals = actualsByCategory(s, from, to);
  const buckets: BucketSummary[] = (['fixed', 'nonmonthly', 'flexible'] as const).map((bucket) => ({ bucket, label: BUCKET_LABEL[bucket], budget: 0, spent: 0, remaining: 0, groups: [] }));
  let incomePlanned = 0, incomeActual = 0;
  for (const g of s.groups) {
    const cats = s.categories.filter((c) => c.groupId === g.id);
    if (g.kind === 'income') {
      for (const c of cats) { incomePlanned += budgetOf(s, c.id, month); incomeActual += actuals.get(c.id) ?? 0; }
      continue;
    }
    if (g.kind !== 'expense' || !g.bucket) continue;
    const rows: BudgetRow[] = cats.map((c) => {
      const budget = budgetOf(s, c.id, month);
      const spent = spentOf(actuals, c.id);
      const rollover = rolloverIn(s, c.id, month);
      return { categoryId: c.id, name: c.name, budget, spent, rollover, remaining: budget + rollover - spent, hasRollover: s.rollovers.some((r) => r.categoryId === c.id && r.enabled) };
    });
    const b = buckets.find((x) => x.bucket === g.bucket)!;
    const gb = rows.reduce((n, r) => n + r.budget, 0), gs = rows.reduce((n, r) => n + r.spent, 0), gr = rows.reduce((n, r) => n + r.remaining, 0);
    b.groups.push({ groupId: g.id, name: g.name, rows, budget: gb, spent: gs, remaining: gr });
    b.budget += gb; b.spent += gs; b.remaining += gr;
  }
  const totalBudget = buckets.reduce((n, b) => n + b.budget, 0);
  const totalSpent = buckets.reduce((n, b) => n + b.spent, 0);
  const expectedIncome = incomePlanned > 0 ? incomePlanned : incomeActual;
  return { buckets, incomePlanned, incomeActual, expectedIncome, totalBudget, totalSpent, leftToBudget: expectedIncome - totalBudget, remaining: expectedIncome - totalSpent };
}

/** Presupuestos iniciales: media de gasto de los meses con datos, redondeada hacia arriba a 5 €. Ingresos: media de ingresos. */
export function defaultBudgets(s: State, fromMonth: string, toMonth: string, today = todayISO()): BudgetItem[] {
  const { kindOf } = catIndex(s);
  const histEnd = addMonths(monthStart(today), -1);
  const hist = monthsBetween(addMonths(histEnd, -5), histEnd);
  const avg = new Map<Id, number>();
  for (const m of hist) {
    const { from, to } = monthRange(m);
    for (const [cat, c] of actualsByCategory(s, from, to)) avg.set(cat, (avg.get(cat) ?? 0) + c / hist.length);
  }
  const items: BudgetItem[] = [];
  for (const m of monthsBetween(fromMonth, toMonth)) {
    for (const c of s.categories) {
      const kind = kindOf(c.id);
      if (kind === 'transfer') continue;
      const a = avg.get(c.id) ?? 0;
      if (kind === 'income') { if (a > 0) items.push({ categoryId: c.id, month: m, amountCents: Math.round(a / 500) * 500 }); continue; }
      if (a < 0) items.push({ categoryId: c.id, month: m, amountCents: Math.ceil(-a / 500) * 500 });
    }
  }
  return items;
}
