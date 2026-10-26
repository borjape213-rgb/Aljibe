import assert from 'node:assert/strict';
import { buildSeed } from './src/logic/seed.ts';
import { accountSeries, accountValueCents, netWorthSeries, actualsByCategory, cashFlow, effectiveParts } from './src/logic/ledger.ts';
import { budgetSummary, rolloverIn, defaultBudgets, budgetOf } from './src/logic/budget.ts';
import { occurrencesInMonth, detectRecurring } from './src/logic/recurring.ts';
import { holdingRows, portfolioReturn, allocation } from './src/logic/invest.ts';
import { parseCSV, guessMapping, rowsFromCSV, planImport, applyRules } from './src/logic/importer.ts';
import { addDays, monthStart, addMonths, todayISO } from './src/logic/dates.ts';

const today = todayISO();
const s = buildSeed();
s.budgetItems = defaultBudgets(s, addMonths(monthStart(today), -8), addMonths(monthStart(today), 1));

// divisiones: la suma siempre cuadra
for (const t of s.transactions) if (t.splits.length) assert.equal(t.splits.reduce((n, p) => n + p.amountCents, 0), t.amountCents);
// el saldo de la serie termina en el saldo actual
for (const a of s.accounts.filter((a) => a.group === 'cash' || a.group === 'credit' || a.group === 'loans')) {
  const ser = accountSeries(s, a, addDays(today, -30), today);
  assert.equal(ser.at(-1).cents, a.balanceCents, a.name);
  assert.equal(ser.length, 31);
}
// serie histórica coherente: saldo de ayer = hoy − movimientos de hoy
const chk = s.accounts.find((a) => a.id === 'a-check');
const ser = accountSeries(s, chk, addDays(today, -3), today);
const todayMoves = s.transactions.filter((t) => t.accountId === chk.id && t.date === today).reduce((n, t) => n + t.amountCents, 0);
assert.equal(ser[2].cents, chk.balanceCents - todayMoves);
// patrimonio = suma de cuentas
const nw = netWorthSeries(s, addDays(today, -5), today);
const sum = s.accounts.reduce((n, a) => n + accountValueCents(s, a), 0);
assert.equal(nw.at(-1).net, sum);
assert.equal(nw.at(-1).assets + nw.at(-1).liabilities, sum);
// presupuesto: traspasos fuera; gasto de la división se reparte
const m = monthStart(addDays(today, -40));
const sm = budgetSummary(s, m);
assert.ok(sm.totalBudget > 0 && sm.expectedIncome > 0);
assert.equal(sm.leftToBudget, sm.expectedIncome - sm.totalBudget);
const act = actualsByCategory(s, m, addDays(addMonths(m, 1), -1));
assert.equal(act.get('c-transfer'), undefined);
// arrastre: seguros con arrastre mensual positivo si se paga una vez al semestre
const r1 = rolloverIn(s, 'c-insurance', addMonths(monthStart(today), 0));
assert.equal(typeof r1, 'number');
const manual = { ...s, budgetItems: [{ categoryId: 'c-insurance', month: addMonths(monthStart(today), -2), amountCents: 10000 }, { categoryId: 'c-insurance', month: addMonths(monthStart(today), -1), amountCents: 10000 }], rollovers: [{ categoryId: 'c-insurance', enabled: true, startMonth: addMonths(monthStart(today), -2), startingBalanceCents: 500 }], transactions: [] };
assert.equal(rolloverIn(manual, 'c-insurance', addMonths(monthStart(today), -2)), 500);
assert.equal(rolloverIn(manual, 'c-insurance', addMonths(monthStart(today), -1)), 500 + 10000);
assert.equal(rolloverIn(manual, 'c-insurance', monthStart(today)), 500 + 20000);
// recurrentes: ocurrencias y detección
const occ = occurrencesInMonth(s, addMonths(monthStart(today), -1));
assert.ok(occ.length >= 7 && occ.filter((o) => o.state === 'paid').length >= 6, 'pagados ' + occ.filter((o) => o.state === 'paid').length);
const det = detectRecurring(s);
assert.ok(!det.some((d) => d.name === 'Alquiler piso'));
// inversiones
const rows = holdingRows(s, null, 91);
assert.equal(rows.length, 5);
const pr = portfolioReturn(s, null, 91);
assert.equal(pr.valueCents, rows.reduce((n, r) => n + r.valueCents, 0));
const al = allocation(rows);
assert.equal(al.parts.reduce((n, p) => n + p.cents, 0), al.total);
assert.ok(Math.abs(al.parts.reduce((n, p) => n + p.pct, 0) - 100) < 1e-9);
// cash flow
const cf = cashFlow(s, m, addDays(addMonths(m, 1), -1), 'group');
assert.equal(cf.net, cf.totalIn + cf.totalOut);
// importación: idempotente y con duplicados legítimos
const csv = 'Fecha;Concepto;Importe\n01/10/2026;Café Plaza;-1,50\n01/10/2026;Café Plaza;-1,50\n02/10/2026;Nómina;"1.234,56"\n31/02/2026;Mal;1\n03/10/2026;Sin importe;abc\n';
const parsed = parseCSV(csv);
const map = guessMapping(parsed[0]);
assert.ok(map);
const { ok, bad } = rowsFromCSV(parsed, map);
assert.equal(ok.length, 3); assert.equal(bad.length, 2);
assert.equal(ok[2].amountCents, 123456);
const p1 = planImport(s, 'a-check', ok);
assert.equal(p1.fresh.length, 3);
const s2 = { ...s, transactions: [...s.transactions, ...p1.fresh.map((f, i) => ({ id: 'x' + i, accountId: 'a-check', date: f.row.date, amountCents: f.row.amountCents, merchant: f.row.merchant, categoryId: 'c-none', notes: '', tags: [], hidden: false, needsReview: false, splits: [], externalId: f.key }))] };
const p2 = planImport(s2, 'a-check', ok);
assert.equal(p2.fresh.length, 0); assert.equal(p2.skipped, 3);
// reglas
assert.deepEqual(applyRules(s.rules, { merchant: 'Gasolinera Norte', categoryId: 'c-none' }), { merchant: 'Gasolinera Norte', categoryId: 'c-fuel' });
console.log('todas las pruebas pasan');
import { netWorthSeries as nws } from './src/logic/ledger.ts';
const empty = { ...s, accounts: [] };
assert.equal(nws(empty, addDays(today, -3), today).length, 4);
assert.equal(nws(empty, addDays(today, -3), today).at(-1).net, 0);
console.log('prueba de estado vacío ok');
import fs from 'node:fs';
import { parseXLSX } from './src/logic/xlsx.ts';
import { rowsFromCSV as rfc, guessMapping as gm } from './src/logic/importer.ts';
const buf = fs.readFileSync('./fixtures/banco.xlsx');
const xr = await parseXLSX(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
assert.equal(xr[0][0], 'Fecha operación');
assert.equal(xr[1][1], 'Café & Co <centro>');
const xm = gm(xr[0]); assert.ok(xm);
const xres = rfc(xr, xm);
assert.equal(xres.ok.length, 5, JSON.stringify(xres));
assert.deepEqual(xres.ok.map((r) => r.date), ['2026-10-01', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-03']);
assert.deepEqual(xres.ok.map((r) => r.amountCents), [-150, -150, 123456, 30, -725]);
assert.equal(xres.bad.length, 1);
console.log('lector de Excel ok');
import { parseXLS } from './src/logic/xls.ts';
import { findHeader } from './src/logic/importer.ts';
const xb = fs.readFileSync('./fixtures/banco.xls');
const old = parseXLS(xb.buffer.slice(xb.byteOffset, xb.byteOffset + xb.byteLength));
assert.equal(old[1][1], 'Café & Co <centro>');
const oh = findHeader(old); assert.ok(oh);
assert.deepEqual(rfc(old, oh.map, oh.index).ok.map((r) => r.amountCents), [-150, -150, 123456, 30, -725]);
// extracto con filas de titular y saldo antes de la tabla (como el del Santander)
const pre = [['', '', 'CUENTA ONLINE', 'FECHA', ''], ['', '', 'Titular', 'Saldo', ''], ['Movimientos'], ['FECHA OPERACIÓN', 'FECHA VALOR', 'CONCEPTO', 'IMPORTE EUR', 'SALDO'], ['23/10/2026', '23/10/2026', 'Recibo luz', '-125', '3859.39']];
const ph = findHeader(pre); assert.equal(ph?.index, 3);
const pre2 = rfc(pre, ph.map, ph.index); assert.equal(pre2.ok.length, 1); assert.equal(pre2.ok[0].amountCents, -12500);
assert.equal(findHeader([['a', 'b']]), null);
console.log('lector de .xls y cabecera con preámbulo ok');
