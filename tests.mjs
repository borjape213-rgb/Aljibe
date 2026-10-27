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

// ---- saldo del extracto, categorías automáticas y recurrentes ----
import { statementInfo } from './src/logic/importer.ts';
import { merchantKey, suggestCategories, isHolder } from './src/logic/merchants.ts';
const sinfo = statementInfo(
  [['', '', 'CUENTA', 'FECHA'], ['', '', 'Titular', 'Saldo'], ['', '', 'PEREZ DE LA IGLESIA ANA', '3.776,07 EUR'], ['Movimientos'], ['FECHA', 'CONCEPTO', 'IMPORTE', 'SALDO'], ['26/10/2026', 'Compra X', '-10', '3776.07']],
  4, { date: 0, merchant: 1, amount: 2, debit: null, credit: null });
assert.equal(sinfo.balanceCents, 377607); assert.equal(sinfo.holder, 'PEREZ DE LA IGLESIA ANA');
// sin saldo en el preámbulo: usa la columna SALDO del movimiento más reciente
const sinfo2 = statementInfo([['FECHA', 'CONCEPTO', 'IMPORTE', 'SALDO'], ['26/10/2026', 'Compra X', '-10', '90.00'], ['25/10/2026', 'Compra Y', '-5', '100.00']], 0, { date: 0, merchant: 1, amount: 2, debit: null, credit: null });
assert.equal(sinfo2.balanceCents, 9000);
assert.ok(isHolder('Transferencia A Favor De Ana Perez De La Iglesia', 'PEREZ DE LA IGLESIA ANA'));
// el mismo comercio con códigos y tarjetas distintos tiene la misma clave
assert.equal(merchantKey('Compra Spotify P47eb1a2c9, Stockholm, Tarjeta 5489010334403142 , Comision 0,00'), merchantKey('Compra Spotify P44802f1d3, Stockholm, Tarjeta 5489010334403142 , Comision 0,00'));
const cs = buildSeed(); cs.transactions = []; cs.recurring = [];
const sg = suggestCategories(cs, [
  { id: 'a', merchant: 'Compra Mercadona Sevilla, Tarjeta 1111222233334444', amountCents: -2350 },
  { id: 'b', merchant: 'Compra Spotify P47eb1a2c9, Stockholm', amountCents: -1099 },
  { id: 'c', merchant: 'Compra Zorbax Qwerty', amountCents: -500 },
], 'PEREZ DE LA IGLESIA ANA');
assert.equal(sg.byId.get('a'), 'c-groceries'); assert.equal(sg.byId.get('b'), 'c-subs'); assert.equal(sg.byId.has('c'), false);
// aprende de lo que ya categorizaste tú
cs.transactions = [{ id: 'x', accountId: 'a-check', date: '2026-09-01', amountCents: -500, merchant: 'Compra Zorbax Qwerty', categoryId: 'c-fun', notes: '', tags: [], hidden: false, needsReview: false, splits: [] }];
assert.equal(suggestCategories(cs, [{ id: 'c', merchant: 'Compra Zorbax Qwerty 99', amountCents: -500 }]).byId.get('c'), undefined); // otro nombre → no se inventa
assert.equal(suggestCategories(cs, [{ id: 'c', merchant: 'Compra Zorbax Qwerty', amountCents: -700 }]).byId.get('c'), 'c-fun');
// recurrente que cambia de código de pedido cada mes (Spotify) y con un mes de hueco
const mk = (date, merchant, cents) => ({ id: date + merchant, accountId: 'a-check', date, amountCents: cents, merchant, categoryId: 'c-subs', notes: '', tags: [], hidden: false, needsReview: false, splits: [] });
cs.transactions = [mk('2026-06-14', 'Compra Spotify P4aaaa111, Stockholm', -2099), mk('2026-07-14', 'Compra Spotify P4bbbb222, Stockholm', -2099), mk('2026-09-15', 'Compra Spotify P4cccc333, Stockholm', -2099), mk('2026-10-14', 'Compra Spotify P4dddd444, Stockholm', -2099)];
const spotDet = detectRecurring(cs);
assert.equal(spotDet.length, 1); assert.equal(spotDet[0].name, 'Spotify'); assert.equal(spotDet[0].amountCents, -2099); assert.equal(spotDet[0].dayOfMonth, 14);
// compras sueltas del mismo comercio en el mismo mes no son recurrentes
cs.transactions = [mk('2026-08-03', 'Compra Mercadona', -1000), mk('2026-08-10', 'Compra Mercadona', -1000), mk('2026-08-17', 'Compra Mercadona', -1000)];
assert.equal(detectRecurring(cs).length, 0);
console.log('saldo del extracto, categorías automáticas y recurrentes ok');

// ---- reglas de categorías (palabras enteras, lo último que eliges manda) ----
{
  const ds = buildSeed(); ds.transactions = []; ds.recurring = [];
  const cat = (m, c = -1000) => suggestCategories(ds, [{ id: 'z', merchant: m, amountCents: c }], 'PEREZ DE LA IGLESIA ANA').byId.get('z');
  assert.equal(cat('Compra Dia Sevilla'), 'c-groceries');
  assert.equal(cat('Compra Bar El Rincon'), 'c-eating');
  assert.equal(cat('Compra Barcelona Viajes Sl'), undefined);       // "bar" no es "Barcelona"
  assert.equal(cat('Compra Media Markt Sevilla') === 'c-groceries', false);  // "dia" no es "media"
  assert.equal(cat('Recibo Gas Natural'), 'c-utilities');
  assert.equal(cat('Compra Gasolinera Repsol'), 'c-fuel');
  assert.equal(cat('Billete Bus Sevilla'), 'c-transit');
  assert.equal(cat('Compra Restaurante La Plaza'), 'c-eating');
  assert.equal(cat('Compra Pizzeria Roma'), 'c-eating');
  assert.equal(cat('Recibo Alquiler Octubre'), 'c-rent');
  assert.notEqual(cat('Alquiler de coche Sixt'), 'c-rent');
  assert.equal(cat('Compra Carnicer a Retinta'), 'c-groceries');
  assert.equal(cat('Recibo Anthropic'), 'c-subs');
  assert.equal(cat('Compra Apple Store iPhone'), undefined);          // "apple" suelto no es suscripción
  assert.equal(cat('Compra Decathlon'), 'c-shopping');
  assert.equal(cat('Compra Yelmo Cines'), 'c-fun');
  assert.equal(cat('Peaje AP-4'), 'c-car');
  assert.equal(cat('Recibo DGT'), 'c-taxes');
  assert.equal(cat('Traspaso propio a ahorro'), 'c-transfer');
  assert.equal(cat('Retirada inversion Mintos'), 'c-transfer');
  assert.equal(cat('Reintegro cajero Sevilla'), 'c-cash');
  // Bizum con concepto → por el concepto; recibido sin concepto → otros ingresos; enviado sin concepto → sin categoría
  assert.equal(cat('Bizum De Pepe Concepto Cena', 1000), 'c-eating');
  assert.equal(cat('Bizum De Pepe', 1000), 'c-otherinc');
  assert.equal(cat('Bizum A Favor De Pepe', -1000), undefined);
  // lo último que has elegido para un comercio manda sobre el diccionario
  const t = (id, date, cat) => ({ id, accountId: 'a-check', date, amountCents: -1000, merchant: 'Compra Mercadona', categoryId: cat, notes: '', tags: [], hidden: false, needsReview: false, splits: [] });
  ds.transactions = [t('1', '2026-05-01', 'c-groceries'), t('2', '2026-06-01', 'c-groceries'), t('3', '2026-07-01', 'c-shopping')];
  assert.equal(cat('Compra Mercadona'), 'c-shopping');
}
console.log('reglas de categorías ok');

// ---- categorizar uno sin categoría arrastra a los demás del mismo comercio ----
import { sameMerchantUncategorized } from './src/logic/merchants.ts';
{
  const mkt = (id, merchant, cents, cat = 'c-none', extra = {}) => ({ id, accountId: 'a-check', date: '2026-09-01', amountCents: cents, merchant, categoryId: cat, notes: '', tags: [], hidden: false, needsReview: false, splits: [], ...extra });
  const txs = [
    mkt('p1', 'Recibo Paypal (europe) S.a R.l. Et Cie, S.c.a Nº recibo 123', -1129),
    mkt('p2', 'Recibo Paypal (europe) S.a R.l. Et Cie, S.c.a Nº recibo 987', -500),
    mkt('p3', 'Recibo Paypal (europe) S.a R.l. Et Cie, S.c.a Nº recibo 555', -700, 'c-fun'),       // ya categorizado: no se toca
    mkt('p4', 'Recibo Paypal (europe) S.a R.l. Et Cie, S.c.a Nº recibo 321', -300, 'c-none', { hidden: true }), // oculto: no
    mkt('p5', 'Recibo Paypal (europe) S.a R.l. Et Cie, S.c.a Nº recibo 222', 2000),                 // devolución: otro signo, no
    mkt('p6', 'Recibo Paypal (europe) S.a R.l. Et Cie, S.c.a Nº recibo 444', -400, 'c-none', { splits: [{ categoryId: 'c-fun', amountCents: -400 }] }), // dividido: no
    mkt('o1', 'Compra Otra Tienda Zorbax', -999),
  ];
  assert.deepEqual(sameMerchantUncategorized(txs, ['p1']), ['p2']);
  assert.deepEqual(sameMerchantUncategorized(txs, ['p3']), []);          // p3 ya tenía categoría: nada que arrastrar
  assert.deepEqual(sameMerchantUncategorized(txs, ['o1']), []);
}
console.log('propagación de categoría ok');
