import type { Id, Rule, State, Transaction } from './types.ts';
import { parseCents } from './money.ts';
import { iso } from './dates.ts';

export function applyRules(rules: Rule[], t: Pick<Transaction, 'merchant' | 'categoryId'>): { merchant: string; categoryId: Id } {
  let { merchant, categoryId } = t;
  for (const r of rules) {
    if (!r.merchantContains || !merchant.toLowerCase().includes(r.merchantContains.toLowerCase())) continue;
    if (r.renameTo) merchant = r.renameTo;
    if (r.setCategoryId) categoryId = r.setCategoryId;
  }
  return { merchant, categoryId };
}

export function parseCSV(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) && first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export function parseDate(x: string): string | null {
  const s = x.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]); // día/mes/año
  m = /^(\d{5})(?:\.\d+)?$/.exec(s); // número de serie de Excel (días desde 1899-12-30)
  if (m && +m[1] >= 25569 && +m[1] <= 73050) {
    const d = new Date(Date.UTC(1899, 11, 30) + +m[1] * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? iso(y, mo, d) : null;
}

export interface ImportRow { date: string; merchant: string; amountCents: number }
export interface Mapping { date: number; merchant: number; amount: number | null; debit: number | null; credit: number | null }

/** Adivina columnas por el encabezado. Devuelve null si no encuentra fecha, descripción e importe. */
export function guessMapping(header: string[]): Mapping | null {
  const find = (re: RegExp) => header.findIndex((h) => re.test(h.trim().toLowerCase()));
  const date = find(/fecha|date/), merchant = find(/concepto|descripci|comercio|merchant|description|detalle/);
  const amount = find(/^importe|amount|cantidad/), debit = find(/d[eé]bito|cargo|gasto|debit/), credit = find(/cr[eé]dito|abono|ingreso|credit/);
  if (date < 0 || merchant < 0 || (amount < 0 && (debit < 0 || credit < 0))) return null;
  return { date, merchant, amount: amount >= 0 ? amount : null, debit: debit >= 0 ? debit : null, credit: credit >= 0 ? credit : null };
}

export function rowsFromCSV(rows: string[][], map: Mapping): { ok: ImportRow[]; bad: { line: number; reason: string }[] } {
  const ok: ImportRow[] = [], bad: { line: number; reason: string }[] = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const date = parseDate(r[map.date] ?? '');
    if (!date) return bad.push({ line, reason: 'Fecha no válida' });
    const merchant = (r[map.merchant] ?? '').trim();
    if (!merchant) return bad.push({ line, reason: 'Sin descripción' });
    let cents: number | null;
    if (map.amount !== null) cents = parseCents(r[map.amount] ?? '');
    else {
      const d = parseCents(r[map.debit!] ?? '0') ?? 0, c = parseCents(r[map.credit!] ?? '0') ?? 0;
      cents = c - Math.abs(d);
      if ((r[map.debit!] ?? '').trim() === '' && (r[map.credit!] ?? '').trim() === '') cents = null;
    }
    if (cents === null) return bad.push({ line, reason: 'Importe no válido' });
    ok.push({ date, merchant, amountCents: cents });
  });
  return { ok, bad };
}

/** Clave estable: cuenta + fecha + importe + texto, más el nº de repetición dentro del archivo (dos cafés iguales el mismo día). */
export function dedupeKeys(accountId: Id, rows: ImportRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${accountId}|${r.date}|${r.amountCents}|${r.merchant.toLowerCase().replace(/\s+/g, ' ')}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

export function planImport(s: State, accountId: Id, rows: ImportRow[]) {
  const existing = new Set(s.transactions.filter((t) => t.accountId === accountId && t.externalId).map((t) => t.externalId!));
  const keys = dedupeKeys(accountId, rows);
  const fresh: { row: ImportRow; key: string }[] = [];
  let skipped = 0;
  rows.forEach((row, i) => (existing.has(keys[i]) ? skipped++ : fresh.push({ row, key: keys[i] })));
  return { fresh, skipped };
}
