import type { RecurringStream, State, Transaction } from './types.ts';
import { addDays, daysBetween, daysInMonth, iso, monthStart, parse, todayISO } from './dates.ts';

export interface Occurrence {
  stream: RecurringStream;
  date: string;
  state: 'paid' | 'upcoming' | 'overdue';
  paidWith?: Transaction;
}

export function datesInMonth(r: RecurringStream, month: string): string[] {
  const { y, m } = parse(month);
  const dim = daysInMonth(month);
  if (r.frequency === 'yearly') return r.month === m ? [iso(y, m, Math.min(r.dayOfMonth, dim))] : [];
  if (r.frequency === 'monthly') return [iso(y, m, Math.min(r.dayOfMonth, dim))];
  const out: string[] = [];
  for (let d = ((r.dayOfMonth - 1) % 7) + 1; d <= dim; d += 7) out.push(iso(y, m, d));
  return out;
}

const norm = (x: string) => x.trim().toLowerCase();
export function matchPayment(s: State, r: RecurringStream, date: string): Transaction | undefined {
  return s.transactions.find((t) => t.accountId === r.accountId && !t.hidden && Math.abs(daysBetween(date, t.date)) <= 4 && norm(t.merchant) === norm(r.name) && Math.sign(t.amountCents) === Math.sign(r.amountCents));
}

export function occurrencesInMonth(s: State, month: string, today = todayISO()): Occurrence[] {
  const out: Occurrence[] = [];
  for (const r of s.recurring) {
    if (r.status !== 'active') continue;
    for (const date of datesInMonth(r, month)) {
      const paidWith = matchPayment(s, r, date);
      out.push({ stream: r, date, paidWith, state: paidWith ? 'paid' : date < today ? 'overdue' : 'upcoming' });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.stream.name.localeCompare(b.stream.name)));
}

/** Comerciantes con ≥3 cobros en meses distintos, importe estable y día parecido, que aún no son recurrentes. */
export function detectRecurring(s: State): RecurringStream[] {
  const known = new Set(s.recurring.map((r) => norm(r.name)));
  const groups = new Map<string, Transaction[]>();
  for (const t of s.transactions) {
    if (t.hidden || s.categories.find((c) => c.id === t.categoryId)?.groupId === 'g-transfer') continue;
    const k = `${norm(t.merchant)}|${t.accountId}|${Math.sign(t.amountCents)}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: RecurringStream[] = [];
  for (const [k, ts] of groups) {
    const name = ts[0].merchant;
    if (known.has(norm(name))) continue;
    const months = new Set(ts.map((t) => monthStart(t.date)));
    if (ts.length < 3 || months.size < 3 || months.size !== ts.length) continue; // exige un cobro por mes
    const amounts = ts.map((t) => Math.abs(t.amountCents)).sort((a, b) => a - b);
    const med = amounts[Math.floor(amounts.length / 2)];
    if (amounts.some((a) => Math.abs(a - med) > med * 0.15)) continue;
    const days = ts.map((t) => parse(t.date).d);
    if (Math.max(...days) - Math.min(...days) > 5) continue;
    const latest = ts.reduce((a, b) => (a.date > b.date ? a : b));
    out.push({ id: `det-${k}`, name, amountCents: latest.amountCents, frequency: 'monthly', dayOfMonth: parse(latest.date).d, categoryId: latest.categoryId, accountId: latest.accountId, status: 'pending-approval' });
  }
  return out;
}
export { addDays };
