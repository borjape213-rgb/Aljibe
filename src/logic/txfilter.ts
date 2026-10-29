import type { Id, Transaction } from './types.ts';
import { needsCategory } from './review.ts';
import { parseCents } from './money.ts';

export type TxType = '' | 'out' | 'in';
export type TxSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';
export const SORTS: { id: TxSort; label: string }[] = [
  { id: 'date-desc', label: 'Fecha: más recientes primero' },
  { id: 'date-asc', label: 'Fecha: más antiguas primero' },
  { id: 'amount-desc', label: 'Importe: de mayor a menor' },
  { id: 'amount-asc', label: 'Importe: de menor a mayor' },
];

export interface TxFilter {
  q?: string;
  acc?: Id;
  cat?: Id;
  status?: string;
  /** Gastos (importe negativo) o ingresos (positivo). */
  type?: TxType;
  /** Desde y hasta, ambos inclusive (AAAA-MM-DD). */
  from?: string;
  to?: string;
  /** Rango de importe en valor absoluto, en céntimos. */
  minCents?: number;
  maxCents?: number;
}

/** Importe escrito por el usuario → céntimos en valor absoluto. Vacío = sin límite (undefined); no válido = null. */
export function parseAbsAmount(text: string | null | undefined): number | undefined | null {
  const t = (text ?? '').trim();
  if (!t) return undefined;
  const c = parseCents(t.replace(/^[+-]/, ''));
  return c === null || c < 0 ? null : c;
}

export function filterTransactions(txs: Transaction[], f: TxFilter): Transaction[] {
  const ql = (f.q ?? '').trim().toLowerCase();
  return txs.filter((t) => {
    if (ql && !t.merchant.toLowerCase().includes(ql) && !t.notes.toLowerCase().includes(ql)) return false;
    if (f.acc && t.accountId !== f.acc) return false;
    if (f.cat && t.categoryId !== f.cat && !t.splits.some((p) => p.categoryId === f.cat)) return false;
    if (f.status && (f.status === 'uncat' || f.status === 'review' ? !needsCategory(t) : f.status === 'hidden' ? !t.hidden : false)) return false;
    if (f.type === 'out' && !(t.amountCents < 0)) return false;
    if (f.type === 'in' && !(t.amountCents > 0)) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    const abs = Math.abs(t.amountCents);
    if (f.minCents !== undefined && abs < f.minCents) return false;
    if (f.maxCents !== undefined && abs > f.maxCents) return false;
    return true;
  });
}

/** Ordena sin tocar la lista original. Por importe se compara el valor absoluto (el gasto más alto y el ingreso más alto cuentan igual). */
export function sortTransactions(txs: Transaction[], sort: TxSort): Transaction[] {
  const byDateDesc = (a: Transaction, b: Transaction) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const out = [...txs];
  if (sort === 'date-asc') out.sort((a, b) => -byDateDesc(a, b));
  else if (sort === 'amount-desc') out.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents) || byDateDesc(a, b));
  else if (sort === 'amount-asc') out.sort((a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents) || byDateDesc(a, b));
  else out.sort(byDateDesc);
  return out;
}
