import type { RecurringStream, State, Transaction } from './types.ts';
import { addDays, daysBetween, daysInMonth, iso, monthStart, parse, todayISO } from './dates.ts';
import { merchantKey, prettyName } from './merchants.ts';

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
  return s.transactions.find((t) => t.accountId === r.accountId && !t.hidden && Math.abs(daysBetween(date, t.date)) <= 4 && (norm(t.merchant) === norm(r.name) || merchantKey(t.merchant) === merchantKey(r.name)) && Math.sign(t.amountCents) === Math.sign(r.amountCents));
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

/** Índice absoluto de mes para medir huecos entre cobros. */
const monthIdx = (d: string) => { const { y, m } = parse(d); return y * 12 + m; };

/**
 * Comercios con cobros mensuales parecidos que aún no son recurrentes. Agrupa por el nombre limpio del comercio
 * (sin números de tarjeta ni códigos de pedido), así "Compra Spotify P47eb…" y "Compra Spotify P44802…" cuentan como uno.
 * Exige ≥3 meses, un cobro por mes, como mucho un mes sin cobro entre medias, importe estable y día parecido.
 */
export function detectRecurring(s: State): RecurringStream[] {
  const known = new Set(s.recurring.map((r) => merchantKey(r.name)));
  const groups = new Map<string, Transaction[]>();
  for (const t of s.transactions) {
    const cat = s.categories.find((c) => c.id === t.categoryId);
    if (t.hidden || cat?.id === 'c-cash') continue;
    // un traspaso solo puede ser recurrente si sale de la cuenta: la entrada en la otra cuenta es el mismo movimiento
    if (cat?.groupId === 'g-transfer' && t.amountCents >= 0) continue;
    const key = merchantKey(t.merchant);
    if (!key) continue;
    const k = `${key}|${t.accountId}|${Math.sign(t.amountCents)}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: RecurringStream[] = [];
  for (const [k, ts] of groups) {
    const key = k.split('|')[0];
    if (known.has(key)) continue;
    const idx = ts.map((t) => monthIdx(t.date)).sort((a, b) => a - b);
    if (ts.length < 3 || new Set(idx).size !== ts.length) continue; // un cobro por mes
    const gaps = idx.slice(1).map((v, i) => v - idx[i]);
    if (gaps.some((g) => g > 2) || gaps.filter((g) => g === 1).length < gaps.length * 0.6) continue;
    const amounts = ts.map((t) => Math.abs(t.amountCents)).sort((a, b) => a - b);
    const med = amounts[Math.floor(amounts.length / 2)];
    const days = ts.map((t) => parse(t.date).d);
    const isTransfer = ts.every((t) => s.categories.find((c) => c.id === t.categoryId)?.groupId === 'g-transfer');
    if (isTransfer) {
      // traspasos: mismo importe exacto y el día no se aleja más de 2 del habitual (fines de semana y festivos)
      if (amounts.some((a) => a !== med)) continue;
      const dsort = [...days].sort((a, b) => a - b), dm = dsort[Math.floor(dsort.length / 2)];
      if (days.some((d) => Math.abs(d - dm) > 2)) continue;
    } else {
      if (amounts.some((a) => Math.abs(a - med) > med * 0.2)) continue;
      if (Math.max(...days) - Math.min(...days) > 7) continue;
    }
    const latest = ts.reduce((a, b) => (a.date > b.date ? a : b));
    out.push({ id: `det-${k}`, name: prettyName(key), amountCents: latest.amountCents, frequency: 'monthly', dayOfMonth: parse(latest.date).d, categoryId: latest.categoryId, accountId: latest.accountId, status: 'pending-approval' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
/** ¿Es un traspaso entre cuentas propias? No cuenta como gasto ni ingreso previsto. */
export function isTransferStream(s: State, r: RecurringStream): boolean {
  return s.categories.find((c) => c.id === r.categoryId)?.groupId === 'g-transfer';
}
export { addDays };
