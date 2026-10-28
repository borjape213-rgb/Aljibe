import type { Id, Rule, State, Transaction } from './types.ts';
import { parseAmount, parseCents } from './money.ts';
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
  // La fecha del movimiento manda sobre la de valor (Sabadell: "F. Operativa" y "F. Valor").
  const date = [/f\.?\s*oper|fecha\s*(de\s*)?oper|fecha\s*(de\s*)?(contab|movimiento)/, /fecha|date|^f\./].map(find).find((i) => i >= 0) ?? -1, merchant = find(/concepto|descripci|comercio|merchant|description|detalle/);
  const amount = find(/^importe|amount|cantidad/), debit = find(/d[eé]bito|cargo|gasto|debit/), credit = find(/cr[eé]dito|abono|ingreso|credit/);
  if (date < 0 || merchant < 0 || (amount < 0 && (debit < 0 || credit < 0))) return null;
  return { date, merchant, amount: amount >= 0 ? amount : null, debit: debit >= 0 ? debit : null, credit: credit >= 0 ? credit : null };
}

/** Busca la fila de encabezados en las primeras 40 filas (los bancos suelen poner titular y saldo antes de la tabla). */
export function findHeader(rows: string[][]): { index: number; map: Mapping } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const map = guessMapping(rows[i]);
    if (map) return { index: i, map };
  }
  return null;
}

export function rowsFromCSV(rows: string[][], map: Mapping, headerIndex = 0): { ok: ImportRow[]; bad: { line: number; reason: string }[] } {
  const ok: ImportRow[] = [], bad: { line: number; reason: string }[] = [];
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const line = headerIndex + i + 2;
    const date = parseDate(r[map.date] ?? '');
    if (!date) return bad.push({ line, reason: 'Fecha no válida' });
    const merchant = (r[map.merchant] ?? '').trim();
    if (!merchant) return bad.push({ line, reason: 'Sin descripción' });
    let cents: number | null;
    if (map.amount !== null) cents = parseAmount(r[map.amount] ?? '');
    else {
      const dt = (r[map.debit!] ?? '').trim(), ct = (r[map.credit!] ?? '').trim();
      const d = dt === '' ? 0 : parseAmount(dt), c = ct === '' ? 0 : parseAmount(ct);
      // una celda con texto que no es un importe no se toma por cero: la fila se marca como no válida
      cents = d === null || c === null || (dt === '' && ct === '') ? null : c - Math.abs(d);
    }
    if (cents === null) {
      // di qué texto no se ha entendido: así se ve si es un formato raro o una columna mal elegida
      const raw = (map.amount !== null ? (r[map.amount] ?? '') : [r[map.debit!], r[map.credit!]].filter((x) => (x ?? '').trim() !== '').join(' / ')).trim().replace(/\s+/g, ' ');
      return bad.push({ line, reason: raw ? `Importe no válido («${raw.length > 24 ? `${raw.slice(0, 24)}…` : raw}»)` : 'Importe vacío' });
    }
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

export interface StatementInfo {
  /** Saldo que indica el extracto, en céntimos. */
  balanceCents?: number;
  /** Titular de la cuenta, si el extracto lo trae antes de la tabla. */
  holder?: string;
}

/** Saca saldo y titular de las filas de antes de la tabla (o, si no, de la columna de saldo del movimiento más reciente). */
export function statementInfo(rows: string[][], headerIndex: number, map: Mapping): StatementInfo {
  const info: StatementInfo = {};
  const num = (x: string | undefined) => (x ? parseCents(x.replace(/[A-Za-z€$£]/g, '').trim()) : null);
  for (let r = 0; r < headerIndex; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const cell = (rows[r][c] ?? '').trim().toLowerCase().replace(/\s*:$/, '');
      if (cell === 'titular' && !info.holder) {
        // Unos bancos ponen el nombre debajo de "Titular", otros en la celda de al lado ("Titular:" | nombre).
        const side = (rows[r][c + 1] ?? '').trim(), below = r + 1 < headerIndex ? (rows[r + 1]?.[c] ?? '').trim() : '';
        const h = /:\s*$/.test((rows[r][c] ?? '').trim()) ? (side || below) : (below || side);
        if (h) info.holder = h;
      }
      if (/^saldo\b/.test(cell) && info.balanceCents === undefined) {
        const v = (r + 1 < headerIndex ? num(rows[r + 1]?.[c]) : null) ?? num(rows[r][c + 1]);
        if (v !== null && v !== undefined) info.balanceCents = v;
      }
    }
  }
  if (info.balanceCents === undefined) {
    const col = (rows[headerIndex] ?? []).findIndex((h) => /^(saldo|balance)/i.test(h.trim()));
    if (col >= 0) {
      const body = rows.slice(headerIndex + 1).map((r) => ({ date: parseDate(r[map.date] ?? ''), bal: num(r[col]) })).filter((x) => x.date && x.bal !== null);
      if (body.length) {
        const newestFirst = body[0].date! >= body[body.length - 1].date!;
        const max = body.reduce((m, x) => (x.date! > m ? x.date! : m), '');
        const same = body.filter((x) => x.date === max);
        info.balanceCents = (newestFirst ? same[0] : same[same.length - 1]).bal!;
      }
    }
  }
  return info;
}
