import assert from 'node:assert/strict';
import { buildSeed } from './src/logic/seed.ts';
import { accountSeries, accountValueCents, netWorthSeries, actualsByCategory, cashFlow, effectiveParts } from './src/logic/ledger.ts';
import { budgetSummary, rolloverIn, defaultBudgets, budgetOf } from './src/logic/budget.ts';
import { occurrencesInMonth, detectRecurring } from './src/logic/recurring.ts';
import { holdingRows, portfolioReturn, allocation, gainPctText } from './src/logic/invest.ts';
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
const s2 = { ...s, transactions: [...s.transactions, ...p1.fresh.map((f, i) => ({ id: 'x' + i, accountId: 'a-check', date: f.row.date, amountCents: f.row.amountCents, merchant: f.row.merchant, categoryId: 'c-none', notes: '', tags: [], hidden: false, splits: [], externalId: f.key }))] };
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
cs.transactions = [{ id: 'x', accountId: 'a-check', date: '2026-09-01', amountCents: -500, merchant: 'Compra Zorbax Qwerty', categoryId: 'c-fun', notes: '', tags: [], hidden: false, splits: [] }];
assert.equal(suggestCategories(cs, [{ id: 'c', merchant: 'Compra Zorbax Qwerty 99', amountCents: -500 }]).byId.get('c'), undefined); // otro nombre → no se inventa
assert.equal(suggestCategories(cs, [{ id: 'c', merchant: 'Compra Zorbax Qwerty', amountCents: -700 }]).byId.get('c'), 'c-fun');
// recurrente que cambia de código de pedido cada mes (Spotify) y con un mes de hueco
const mk = (date, merchant, cents) => ({ id: date + merchant, accountId: 'a-check', date, amountCents: cents, merchant, categoryId: 'c-subs', notes: '', tags: [], hidden: false, splits: [] });
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
  const t = (id, date, cat) => ({ id, accountId: 'a-check', date, amountCents: -1000, merchant: 'Compra Mercadona', categoryId: cat, notes: '', tags: [], hidden: false, splits: [] });
  ds.transactions = [t('1', '2026-05-01', 'c-groceries'), t('2', '2026-06-01', 'c-groceries'), t('3', '2026-07-01', 'c-shopping')];
  assert.equal(cat('Compra Mercadona'), 'c-shopping');
}
console.log('reglas de categorías ok');

// ---- categorizar uno sin categoría arrastra a los demás del mismo comercio ----
import { sameMerchantUncategorized } from './src/logic/merchants.ts';
{
  const mkt = (id, merchant, cents, cat = 'c-none', extra = {}) => ({ id, accountId: 'a-check', date: '2026-09-01', amountCents: cents, merchant, categoryId: cat, notes: '', tags: [], hidden: false, splits: [], ...extra });
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

// ---- cola de "Sin categoría": los saltados van al final, en el orden en que se saltan ----
import { categorizeQueue, needsCategory } from './src/logic/review.ts';
{
  const q = (id, cat = 'c-none', extra = {}) => ({ id, accountId: 'a-check', date: '2026-09-01', amountCents: -100, merchant: id, categoryId: cat, notes: '', tags: [], hidden: false, splits: [], ...extra });
  const txs = [q('a'), q('b'), q('c'), q('d'), q('e', 'c-fun'), q('f', 'c-none', { hidden: true }), q('g', 'c-none', { splits: [{ categoryId: 'c-fun', amountCents: -100 }] })];
  const ids = (l) => l.map((t) => t.id);
  assert.deepEqual(ids(categorizeQueue(txs, [])), ['a', 'b', 'c', 'd']);                 // solo sin categoría, visibles y sin dividir
  assert.deepEqual(ids(categorizeQueue(txs, ['a'])), ['b', 'c', 'd', 'a']);              // saltar "a": pasa al final
  assert.deepEqual(ids(categorizeQueue(txs, ['a', 'b'])), ['c', 'd', 'a', 'b']);         // el último saltado, el último
  assert.deepEqual(ids(categorizeQueue(txs.map((t) => (t.id === 'b' ? { ...t, categoryId: 'c-fun' } : t)), ['a', 'b'])), ['c', 'd', 'a']); // un saltado ya categorizado desaparece
  assert.equal(needsCategory(txs[0]), true); assert.equal(needsCategory(txs[4]), false);
}
console.log('cola de sin categoría ok');

// ---- importes tal como los escriben los bancos: moneda, paréntesis y signo detrás ----
import { parseAmount } from './src/logic/money.ts';
{
  const good = [['-45,20 €', -4520], ['45,20 EUR', 4520], ['EUR 45,20', 4520], ['(45,20)', -4520], ['45,20-', -4520], ['−45,20 €', -4520], ['1.234,56 €', 123456], ['-1.234,56 EUR', -123456],
    ['$ 12', 1200], ['+45,20', 4520], ['(45,20) €', -4520], ['(45,20 €)', -4520], ['45,20 €', 4520], ['  -1,50€ ', -150], ['45,20 euros', 4520]];
  for (const [input, expected] of good) assert.equal(parseAmount(input), expected, input);
  // lo ambiguo o que no es un importe se rechaza, no se adivina
  for (const bad of ['', '€', 'abc', '(-45,20)', '-45,20-', '--5', '45,2,0', '12 345 EUR x', '1,2345 €']) assert.equal(parseAmount(bad), null, JSON.stringify(bad));
  const csv = parseCSV('Fecha;Concepto;Importe\n01/10/2026;Café;-1,50 €\n01/10/2026;Café;-1,50 €\n02/10/2026;Nómina;"1.234,56 EUR"\n03/10/2026;Recibo;(45,20)\n04/10/2026;Otro;45,20-\n05/10/2026;Raro;abc\n06/10/2026;Vacío;\n');
  const one = rowsFromCSV(csv, guessMapping(csv[0]));
  assert.deepEqual(one.ok.map((r) => r.amountCents), [-150, -150, 123456, -4520, -4520]);
  assert.equal(one.bad.length, 2);
  assert.match(one.bad[0].reason, /«abc»/);       // el mensaje dice qué texto no se ha entendido
  assert.equal(one.bad[1].reason, 'Importe vacío');
  const dc = parseCSV('Fecha;Concepto;Cargo;Abono\n01/10/2026;A;12,50 €;\n02/10/2026;B;;100,00 €\n03/10/2026;C;xx;\n04/10/2026;D;;\n');
  const two = rowsFromCSV(dc, guessMapping(dc[0]));
  assert.deepEqual(two.ok.map((r) => r.amountCents), [-1250, 10000]);
  assert.deepEqual(two.bad.map((b) => b.line), [4, 5]);   // texto raro en una celda ≠ cero; fila sin importe tampoco
}
console.log('importes con símbolo de moneda ok');

// ---- validar lo guardado y las copias de seguridad antes de sustituir datos ----
import { normalizeState, countsOf } from './src/logic/state.ts';
{
  const full = JSON.parse(JSON.stringify(s));
  const ok = normalizeState(full);
  assert.ok(ok.ok, ok.error);
  assert.deepEqual(ok.state.transactions, s.transactions);   // un estado bueno pasa sin cambios
  assert.deepEqual(ok.state.accounts, s.accounts);
  assert.deepEqual(countsOf(ok.state), { accounts: s.accounts.length, transactions: s.transactions.length });

  // a una copia a la que le faltan partes opcionales se le completan los valores por defecto (antes rompía el renderizado)
  const min = normalizeState({ version: 1, accounts: [], transactions: [], categories: [] });
  assert.ok(min.ok);
  for (const k of ['rules', 'holdings', 'securities', 'recurring', 'budgetItems', 'rollovers', 'tags', 'benchmarks']) assert.deepEqual(min.state[k], [], k);
  assert.deepEqual(min.state.prices, {});
  assert.equal(min.state.settings.currency, 'EUR');
  assert.ok(min.state.settings.dashboardWidgets.length && min.state.settings.navItems.length);
  assert.ok(min.state.categories.some((c) => c.id === 'c-none') && min.state.groups.some((g) => g.id === min.state.categories.find((c) => c.id === 'c-none').groupId));
  // ajustes parciales: se conservan los que hay y se completa el resto
  const part = normalizeState({ version: 1, accounts: [], transactions: [], categories: [], settings: { theme: 'dark', currency: 'EUR', locale: 'es-ES' } });
  assert.ok(part.ok); assert.equal(part.state.settings.theme, 'dark'); assert.ok(Array.isArray(part.state.settings.dashboardWidgets));
  // la marca antigua "por revisar" se descarta
  const legacy = normalizeState({ version: 1, accounts: [], categories: [], transactions: [{ id: 't1', accountId: 'a', date: '2026-01-02', amountCents: -100, categoryId: 'c-none', needsReview: true }] });
  assert.ok(legacy.ok); assert.equal('needsReview' in legacy.state.transactions[0], false); assert.deepEqual(legacy.state.transactions[0].tags, []);

  // lo esencial roto no se arregla: se rechaza diciendo por qué
  const base = { version: 1, accounts: [], transactions: [], categories: [] };
  const rejects = (raw, re) => { const r = normalizeState(raw); assert.equal(r.ok, false, JSON.stringify(raw).slice(0, 90)); assert.match(r.error, re); };
  rejects(null, /no es una copia/); rejects([], /no es una copia/); rejects({}, /no es una copia/); rejects('x', /no es una copia/);
  rejects({ ...base, version: 2 }, /Versión de datos no reconocida \(2\)/);
  rejects({ ...base, accounts: undefined }, /cuentas/); rejects({ ...base, transactions: undefined }, /movimientos/); rejects({ ...base, categories: undefined }, /categorías/);
  rejects({ ...base, accounts: {} }, /cuentas/); rejects({ ...base, groups: 'x' }, /grupos/);
  const tx = (o) => ({ id: 't1', accountId: 'a', date: '2026-01-02', amountCents: -100, categoryId: 'c-none', ...o });
  rejects({ ...base, transactions: [tx({ date: 'ayer' })] }, /Movimiento 1: fecha/);
  rejects({ ...base, transactions: [tx({ amountCents: 12.5 })] }, /Movimiento 1: importe/);
  rejects({ ...base, transactions: [tx({ amountCents: '12' })] }, /Movimiento 1: importe/);
  rejects({ ...base, transactions: [tx({ splits: [{ categoryId: 'x' }] })] }, /división/);
  rejects({ ...base, accounts: [{ id: 'a', name: 'X', group: 'cash', balanceCents: '10' }] }, /saldo/);
  rejects({ ...base, accounts: [{ id: 'a', name: 'X', group: 'banco', balanceCents: 10 }] }, /tipo/);
  rejects({ ...base, prices: { x: [{ date: '2026-01-01' }] } }, /precios/);
  rejects({ ...base, holdings: [{ id: 'h', accountId: 'a' }] }, /Posición 1/);
  rejects({ ...base, settings: { currency: 5 } }, /ajustes/);
}
console.log('validación de datos guardados y copias ok');

// extracto con formato Sabadell (datos inventados): fecha operativa, preámbulo "Etiqueta:" | valor, más reciente primero
{
  const { findHeader, statementInfo } = await import('./src/logic/importer.ts');
  const { dictionaryCategory, merchantKey } = await import('./src/logic/merchants.ts');
  const rows = [
    ['Consulta de movimientos'], ['16/10/2026 14:26:05'], ['Cuenta: ', 'ES00 0000 0000 0000 0000 0000'], ['Divisa: ', 'EUR'],
    ['Titular:', 'ANA*GARCIA LOPEZ'], ['Selección:', 'Desde 15/07/2026 hasta 15/10/2026'],
    ['F. Operativa', 'Concepto', 'F. Valor', 'Importe', 'Saldo', 'Referencia 1', 'Referencia 2'],
    ['30/09/2026', 'PRESTAMOS ADEUDO CUOTA N.1234567 30/09/26', '30/09/2026', '-124.75', '564.02', '', ''],
    ['24/09/2026', 'BONIFIC. COMISION MANT. CUENTA', '24/09/2026', '60', '688.77', '', ''],
    ['24/09/2026', 'INTERESES Y/O COMISIONES CUENTA', '24/09/2026', '-60', '628.77', '', ''],
    ['31/08/2026', 'PRESTAMOS ADEUDO CUOTA N.1234567 31/08/26', '31/08/2026', '-124.75', '838.31', '', ''],
  ];
  const h = findHeader(rows);
  assert.equal(h.index, 6); assert.equal(h.map.date, 0, 'F. Operativa, no F. Valor'); assert.equal(h.map.amount, 3);
  assert.equal(guessMapping(['F. Valor', 'Concepto', 'Importe']).date, 0, 'sin operativa, sirve la de valor');
  const r = rowsFromCSV(rows, h.map, h.index);
  assert.equal(r.bad.length, 0); assert.equal(r.ok.length, 4); assert.equal(r.ok[0].date, '2026-09-30'); assert.equal(r.ok[0].amountCents, -12475);
  const info = statementInfo(rows, h.index, h.map);
  assert.equal(info.holder, 'ANA*GARCIA LOPEZ'); assert.equal(info.balanceCents, 56402);
  assert.equal(dictionaryCategory(rows[7][1], -12475), 'loan'); assert.equal(dictionaryCategory(rows[8][1], 6000), 'fees'); assert.equal(dictionaryCategory(rows[9][1], -6000), 'fees');
  assert.equal(merchantKey(rows[7][1]), merchantKey(rows[10][1]), 'la cuota de cada mes comparte clave');
  assert.equal(dictionaryCategory('SEGUROS BANSABADELL VIDA,S.A.', -14954), 'insurance');
  // titular debajo de la etiqueta (otros bancos)
  assert.equal(statementInfo([['Titular'], ['Ana Garcia'], ['Fecha', 'Concepto', 'Importe']], 2, { date: 0, merchant: 1, amount: 2, debit: null, credit: null }).holder, 'Ana Garcia');
  // tres cuotas mensuales iguales se detectan como recurrentes
  const st = buildSeed(); st.transactions = []; st.recurring = []; st.accounts = [{ ...st.accounts[0], id: 'aa' }];
  st.transactions = ['2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'].map((d, i) => ({ id: 'q' + i, accountId: 'aa', date: d, amountCents: -12475, merchant: `PRESTAMOS ADEUDO CUOTA N.1234567 ${d.slice(8)}/${d.slice(5, 7)}/26`, categoryId: 'c-loan', notes: '', tags: [], splits: [] }));
  assert.ok(detectRecurring(st).length >= 1, 'cuota mensual detectada como recurrente');
}
console.log('extracto tipo Sabadell ok');

// ---- actualización de precios bajo demanda (proveedor simulado: la integración continua no usa internet) ----
{
  const { toProviderSymbol, parseDaily, parseFx, fetchQuotes, previewQuotes } = await import('./src/logic/quotes.ts');
  assert.equal(toProviderSymbol('AIR:EPA'), 'AIR.PAR'); assert.equal(toProviderSymbol(' sap:etr '), 'SAP.DEX');
  assert.equal(toProviderSymbol('AIR.PAR'), 'AIR.PAR'); assert.equal(toProviderSymbol('aapl'), 'AAPL'); assert.equal(toProviderSymbol('XYZ:ZZZ'), 'XYZ.ZZZ');
  const daily = (o) => ({ 'Meta Data': {}, 'Time Series (Daily)': o });
  const d = parseDaily(daily({ '2026-10-26': { '4. close': '140.0' }, '2026-10-27': { '4. close': '142.50' }, '2026-10-23': { '4. close': '1' } }));
  assert.deepEqual(d, { ok: true, value: { date: '2026-10-27', close: 142.5 } });
  assert.equal(parseDaily({ 'Error Message': 'Invalid API call' }).error, 'not-found');
  assert.equal(parseDaily({ Information: 'Our standard API rate limit is 25 requests per day.' }).error, 'rate-limit');
  assert.equal(parseDaily({ Information: 'Invalid API key' }).error, 'provider');
  assert.equal(parseDaily({}).error, 'bad-data'); assert.equal(parseDaily(daily({ '2026-10-27': { '4. close': '0' } })).error, 'bad-data'); assert.equal(parseDaily(null).error, 'bad-data');
  assert.equal(parseFx({ rate: 0.92 }, 'EUR').value, 0.92); assert.equal(parseFx({ rates: { EUR: 0.93 } }, 'EUR').value, 0.93); assert.equal(parseFx({ rate: 0 }, 'EUR').ok, false);
  const calls = [];
  const mk = (map) => async (url) => { calls.push(url); const k = Object.keys(map).find((x) => url.includes(x)); if (!k) throw new Error('sin red'); const v = map[k]; return { ok: true, json: async () => v }; };
  const f = mk({ 'AIR.PAR': daily({ '2026-10-27': { '4. close': '150' } }), 'AAPL': daily({ '2026-10-27': { '4. close': '200' } }), 'frankfurter': { rate: 0.9 } });
  const res = await fetchQuotes({ apiKey: 'K', base: 'EUR', gapMs: 0, fetchFn: f, items: [{ id: 'a', symbol: 'AIR:EPA', currency: 'EUR' }, { id: 'b', symbol: 'AAPL', currency: 'USD' }, { id: 'c', symbol: '', currency: 'EUR' }, { id: 'e', symbol: 'NOPE', currency: 'EUR' }] });
  assert.equal(res[0].price, 150); assert.equal(res[1].price, 180); assert.equal(res[1].nativePrice, 200); assert.equal(res[1].rate, 0.9);
  assert.equal(res[2].error, 'no-symbol'); assert.equal(res[3].error, 'network');
  assert.ok(calls.every((u) => !u.includes('frankfurter') || !u.includes('K')), 'la clave no va al servicio de cambio');
  assert.equal(calls.filter((u) => u.includes('frankfurter')).length, 1);
  // al llegar al límite no se siguen pidiendo valores
  calls.length = 0;
  const lim = mk({ AAA: { Information: 'rate limit of 25 requests per day' }, BBB: daily({ '2026-10-27': { '4. close': '1' } }) });
  const r2 = await fetchQuotes({ apiKey: 'K', base: 'EUR', gapMs: 0, fetchFn: lim, items: [{ id: '1', symbol: 'AAA', currency: 'EUR' }, { id: '2', symbol: 'BBB', currency: 'EUR' }] });
  assert.equal(r2[0].error, 'rate-limit'); assert.equal(r2[1].error, 'rate-limit'); assert.equal(calls.length, 1);
  // el cambio no disponible deja el valor sin actualizar en lugar de guardar un precio en dólares como si fueran euros
  const nofx = mk({ AAPL: daily({ '2026-10-27': { '4. close': '200' } }), frankfurter: {} });
  assert.equal((await fetchQuotes({ apiKey: 'K', base: 'EUR', gapMs: 0, fetchFn: nofx, items: [{ id: 'b', symbol: 'AAPL', currency: 'USD' }] }))[0].error, 'fx');
  // vista previa: salto grande y fecha antigua quedan marcados
  const pv = previewQuotes({ a: [{ date: '2026-10-20', price: 100 }], b: [{ date: '2026-10-28', price: 10 }], c: [] }, [{ id: 'a', ok: true, date: '2026-10-27', price: 160 }, { id: 'b', ok: true, date: '2026-10-27', price: 10.5 }, { id: 'c', ok: true, date: '2026-10-27', price: 5 }, { id: 'x', ok: false }]);
  assert.equal(pv.length, 3); assert.equal(pv[0].suspicious, true); assert.equal(pv[1].stale, true); assert.equal(pv[2].changePct, null);
  // los campos nuevos de un valor sobreviven a guardar y restaurar; los inválidos se descartan
  const { normalizeState } = await import('./src/logic/state.ts');
  const st = buildSeed(); st.securities = [{ ...st.securities[0], symbol: 'AIR:EPA', currency: 'USD', updatedAt: '2026-10-27T10:00:00.000Z' }, { ...st.securities[1], symbol: 5, currency: null }];
  const n = normalizeState(JSON.parse(JSON.stringify(st)));
  assert.ok(n.ok); assert.equal(n.state.securities[0].symbol, 'AIR:EPA'); assert.equal(n.state.securities[0].currency, 'USD'); assert.equal(n.state.securities[1].symbol, undefined);
  assert.ok(!JSON.stringify(n.state).includes('apikey'), 'ninguna clave en el estado');
}
console.log('actualización de precios ok');

// tipo de cuenta Loans (dinero prestado): sin posiciones ni movimientos, vale lo que se apunta a mano
{
  const { hasNoMovements } = await import('./src/logic/ledger.ts');
  const { normalizeState } = await import('./src/logic/state.ts');
  const st = buildSeed();
  const loan = { id: 'a-ln', name: 'Préstamos concedidos', group: 'lent', subtype: 'Loans', balanceCents: 250000, currency: 'EUR', hidden: false, updatedAt: '2026-10-28T10:00:00', valuations: [{ date: '2026-01-01', cents: 100000 }, { date: '2026-09-01', cents: 250000 }] };
  st.accounts = [...st.accounts, loan];
  assert.ok(hasNoMovements(loan)); assert.ok(hasNoMovements({ group: 'investments' })); assert.ok(!hasNoMovements({ group: 'cash' }));
  assert.equal(accountValueCents(st, loan), 250000, 'vale su saldo');
  const ser = accountSeries(st, loan, '2026-08-30', '2026-09-02');
  assert.deepEqual(ser.map((p) => p.cents), [100000, 100000, 250000, 250000], 'el histórico sale de las valoraciones guardadas');
  const nw0 = netWorthSeries(buildSeed(), addDays(today, -1), today).at(-1).net, nw1 = netWorthSeries(st, addDays(today, -1), today).at(-1).net;
  assert.equal(nw1 - nw0, 250000, 'suma al patrimonio');
  // la versión intermedia lo guardaba como inversión con subtipo Loans: se pasa al tipo nuevo sin perder nada
  const old = JSON.parse(JSON.stringify(buildSeed())); old.accounts.push({ ...loan, group: 'investments' });
  const n = normalizeState(old); assert.ok(n.ok); const mig = n.state.accounts.find((a) => a.id === 'a-ln');
  assert.equal(mig.group, 'lent'); assert.equal(mig.balanceCents, 250000);
  assert.equal(n.state.accounts.find((a) => a.group === 'investments' && a.subtype !== 'Loans').group, 'investments');
}
console.log('cuentas Loans ok');

// posiciones: precio unitario de compra y actual
{
  const st = buildSeed();
  const h = st.holdings.find((x) => x.costBasisCents !== null), nocost = st.holdings.find((x) => x.costBasisCents === null);
  const rows = holdingRows(st, null, 30);
  const r = rows.find((x) => x.holding.id === h.id);
  assert.ok(Math.abs(r.unitCost * h.quantity * 100 - h.costBasisCents) < 1e-6, 'coste unitario × cantidad = coste total');
  assert.ok(r.unitPrice > 0 && Math.abs(r.unitPrice * h.quantity * 100 - r.valueCents) <= 50 + 1e-6, 'valor = cantidad × precio actual');
  assert.equal(rows.find((x) => x.holding.id === nocost.id).unitCost, null);
  // el coste total sale de cantidad × precio unitario, redondeado a céntimos
  assert.equal(Math.round(85.5 * 133.436752 * 100), 1140884);
}
console.log('posiciones: precios unitarios ok');

// ---- cálculo de posiciones: contra las cifras de un broker real y contra un cálculo independiente ----
{
  const { costOf } = await import('./src/logic/invest.ts');
  const mkState = (specs) => {
    const st = buildSeed(); st.accounts = [{ id: 'A', name: 'B', group: 'investments', subtype: 'Fondos', balanceCents: 0, currency: 'EUR', hidden: false, updatedAt: '2026-10-29T00:00:00' }];
    st.securities = specs.map((x, i) => ({ id: 's' + i, ticker: 'T' + i, name: 'V' + i, assetClass: 'equity' }));
    st.prices = Object.fromEntries(specs.map((x, i) => ['s' + i, [{ date: addDays(today, -400), price: x.price * 0.5 }, { date: today, price: x.price }]]));
    st.holdings = specs.map((x, i) => ({ id: 'h' + i, accountId: 'A', securityId: 's' + i, quantity: x.q, costBasisCents: x.unit === null ? null : Math.round(x.q * x.unit * 100), unitCost: x.unit }));
    return st;
  };
  // Nasdaq-100: 117 uds a 305,35 € con compra a 133,436752 → valor 35.725,95; ganancia 20.113,85 (+128,83 %)
  // S&P 500: 63 uds a 203,00 € con compra a 117,828 → valor 12.789,00; ganancia 5.365,84 (+72,28 %)
  const st = mkState([{ q: 117, price: 305.35, unit: 133.436752 }, { q: 63, price: 203, unit: 117.828 }]);
  const [nq, sp] = ['h0', 'h1'].map((id) => holdingRows(st, null, 30).find((r) => r.holding.id === id));
  assert.equal(nq.valueCents, 3572595); assert.equal(nq.gainCents, 2011385); assert.ok(Math.abs(nq.gainPct - 128.83) <= 0.0101, 'el % cae justo en el límite de redondeo (128,835): el broker muestra 128,83'); assert.equal(nq.gainPct.toFixed(3), '128.835');
  assert.equal(sp.valueCents, 1278900); assert.equal(sp.gainCents, 536584); assert.ok(Math.abs(sp.gainPct - 72.28) <= 0.0101, 'el broker trunca (72,285 → 72,28); gainPct es el valor exacto y gainPctText lo corta'); assert.equal(sp.gainPct.toFixed(3), '72.285');
  assert.equal(gainPctText(nq.gainPct), '+128,83 %', 'como el broker: 128,835 se corta a 128,83');
  assert.equal(gainPctText(sp.gainPct), '+72,28 %', 'como el broker: 72,285 se corta a 72,28');
  assert.equal(gainPctText(12.847), '+12,84 %'); assert.equal(gainPctText(-12.847), '−12,84 %', 'en negativo también se corta hacia cero');
  assert.equal(gainPctText(12.84), '+12,84 %'); assert.equal(gainPctText(12.839999999999), '+12,84 %', 'el ruido de coma flotante no baja un centésimo'); assert.equal(gainPctText(0), '+0,00 %'); assert.equal(gainPctText(12345.678), '+12.345,67 %');
  assert.equal(sp.unitCost, 117.828, 'el precio de compra se conserva exacto'); assert.equal(sp.unitPrice, 203);
  // el valor no depende del precio de compra; la ganancia y el % sí
  const base = mkState([{ q: 63, price: 203, unit: 100 }]), alt = mkState([{ q: 63, price: 203, unit: 150 }]);
  const a = holdingRows(base, null, 30)[0], b = holdingRows(alt, null, 30)[0];
  assert.equal(a.valueCents, b.valueCents); assert.equal(a.gainCents, 63 * 103 * 100); assert.equal(b.gainCents, 63 * 53 * 100);
  assert.ok(a.gainPct > b.gainPct);
  // sin precio de compra no hay ganancia; una posición antigua con solo coste total sigue funcionando
  assert.equal(holdingRows(mkState([{ q: 5, price: 10, unit: null }]), null, 30)[0].gainCents, null);
  const old = mkState([{ q: 10, price: 20, unit: 5 }]); delete old.holdings[0].unitCost; old.holdings[0].costBasisCents = 5000;
  const o = holdingRows(old, null, 30)[0]; assert.equal(o.gainCents, 15000); assert.equal(o.unitCost, 5); assert.equal(costOf(old.holdings[0]), 5000);
  // aleatorio: cada fila coincide con un cálculo independiente y todo suma
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const specs = Array.from({ length: 40 }, () => ({ q: Math.round(rnd() * 5000) / 100 + 0.01, price: Math.round(rnd() * 50000) / 100 + 0.01, unit: rnd() < 0.2 ? null : Math.round(rnd() * 5000000) / 10000 }));
  const rs = mkState(specs), rows = holdingRows(rs, null, 30);
  specs.forEach((x, i) => {
    const r = rows.find((y) => y.holding.id === 'h' + i), val = x.q * x.price * 100;
    assert.equal(r.valueCents, Math.round(val));
    if (x.unit === null) assert.equal(r.gainCents, null);
    else { const cost = x.q * x.unit * 100; assert.equal(r.gainCents, Math.round(val) - Math.round(cost)); if (Math.round(cost) > 0) assert.ok(Math.abs(r.gainPct - ((Math.round(val) - Math.round(cost)) / Math.round(cost)) * 100) < 1e-9); }
  });
  const sum = rows.reduce((n, r) => n + r.valueCents, 0);
  assert.equal(accountValueCents(rs, rs.accounts[0]), sum, 'el valor de la cuenta es la suma de sus posiciones');
  assert.equal(allocation(rows).total, sum); assert.equal(portfolioReturn(rs, null, 30).valueCents, sum);
  assert.equal(netWorthSeries(rs, addDays(today, -1), today).at(-1).net, sum, 'el patrimonio es la suma');
}
console.log('cálculo de posiciones ok');

// ---- valores en otra moneda (p. ej. NVIDIA en USD): se escriben y se ven en su moneda; totales y ganancia en euros ----
{
  const { currentFx, isForeign } = await import('./src/logic/invest.ts');
  const { fetchRate } = await import('./src/logic/quotes.ts');
  const mk = (sec, hold) => {
    const st = buildSeed(); st.settings = { ...st.settings, currency: 'EUR' };
    st.accounts = [{ id: 'A', name: 'B', group: 'investments', subtype: 'Fondos', balanceCents: 0, currency: 'EUR', hidden: false, updatedAt: '2026-10-29T00:00:00' }];
    st.securities = [{ id: 'n', ticker: 'NVDA', name: 'NVIDIA', assetClass: 'equity', ...sec }];
    st.prices = { n: [{ date: today, price: 180 }] }; // guardado en euros: 200 USD × 0,9
    st.holdings = [{ id: 'h', accountId: 'A', securityId: 'n', quantity: 10, costBasisCents: 0, ...hold }];
    return st;
  };
  const usd = { currency: 'USD', fxRate: 0.9 };
  const a = holdingRows(mk(usd, { unitCost: 150, costBasisCents: 135000 }), null, 30)[0];
  assert.equal(a.currency, 'USD'); assert.equal(a.unitPrice, 200); assert.equal(a.unitCost, 150); assert.equal(a.valueCents, 180000);
  assert.equal(a.gainCents, 180000 - 135000, 'sin cambio de compra se usa el actual (150 USD × 0,9)');
  const b = holdingRows(mk(usd, { unitCost: 150, costFx: 0.92, costBasisCents: 138000 }), null, 30)[0];
  assert.equal(b.gainCents, 180000 - 138000, 'con el cambio de la compra: 10 × 150 × 0,92 = 1.380 €'); assert.equal(b.unitCost, 150, 'el precio de compra se enseña en dólares');
  // el valor no depende del cambio de compra
  assert.equal(a.valueCents, b.valueCents);
  // sin cambio conocido: avisa y trata los importes como ya convertidos
  const m = holdingRows(mk({ currency: 'USD' }, { unitCost: 150, costBasisCents: 150000 }), null, 30)[0];
  assert.equal(m.fxMissing, true); assert.equal(m.currency, 'EUR'); assert.equal(m.unitPrice, 180);
  // en euros no cambia nada
  const e = holdingRows(mk({ currency: 'EUR' }, { unitCost: 150, costBasisCents: 150000 }), null, 30)[0];
  assert.equal(e.fxMissing, false); assert.equal(e.currency, 'EUR'); assert.equal(e.unitPrice, 180);
  assert.equal(currentFx(mk(usd, {}), { currency: 'USD', fxRate: 0.9 }), 0.9); assert.equal(currentFx(mk(usd, {}), { currency: 'EUR' }), 1); assert.equal(currentFx(mk(usd, {}), { currency: 'USD' }), null);
  assert.ok(isForeign(mk(usd, {}), { currency: 'usd' })); assert.ok(!isForeign(mk(usd, {}), {}));
  // lectura del cambio con el proveedor simulado
  const f = async () => ({ ok: true, json: async () => ({ rate: 0.91 }) });
  assert.deepEqual(await fetchRate('USD', 'EUR', f), { ok: true, value: 0.91 });
  assert.equal((await fetchRate('USD', 'EUR', async () => { throw new Error('sin red'); })).ok, false);
}
console.log('valores en otra moneda ok');

// ---- reglas con importe exacto ----
{
  const { ruleMatches } = await import('./src/logic/importer.ts');
  const base = { id: 'r', merchantContains: '', setCategoryId: 'c-loan' };
  const tx = (merchant, amountCents) => ({ merchant, amountCents });
  const onlyAmt = { ...base, amountCents: 12475 };
  assert.ok(ruleMatches(onlyAmt, tx('PRESTAMOS CUOTA', -12475)), 'solo importe: gasto'); assert.ok(ruleMatches(onlyAmt, tx('X', 12475)), 'sin dirección vale ingreso y gasto');
  assert.ok(!ruleMatches(onlyAmt, tx('X', -12476)), 'otro importe'); assert.ok(!ruleMatches(onlyAmt, { merchant: 'X' }), 'sin importe conocido no se aplica');
  assert.ok(ruleMatches({ ...onlyAmt, amountDirection: 'out' }, tx('X', -12475))); assert.ok(!ruleMatches({ ...onlyAmt, amountDirection: 'out' }, tx('X', 12475)));
  assert.ok(ruleMatches({ ...onlyAmt, amountDirection: 'in' }, tx('X', 12475))); assert.ok(!ruleMatches({ ...onlyAmt, amountDirection: 'in' }, tx('X', -12475)));
  const both = { ...base, merchantContains: 'prestamos', amountCents: 12475 };
  assert.ok(ruleMatches(both, tx('PRESTAMOS ADEUDO', -12475))); assert.ok(!ruleMatches(both, tx('PRESTAMOS ADEUDO', -9999)), 'texto sí, importe no'); assert.ok(!ruleMatches(both, tx('OTRA COSA', -12475)), 'importe sí, texto no');
  assert.ok(!ruleMatches({ id: 'x', merchantContains: '' }, tx('X', 1)), 'una regla sin condiciones no se aplica');
  // las reglas antiguas (solo texto) siguen igual
  assert.ok(ruleMatches({ id: 'o', merchantContains: 'GASOLINERA', setCategoryId: 'c' }, tx('Gasolinera Repsol', -5000)));
  // se aplican en la importación con el importe de cada fila
  const res = applyRules([{ ...base, amountCents: 6000, amountDirection: 'out', setCategoryId: 'c-fees' }, both], { merchant: 'INTERESES Y/O COMISIONES', categoryId: 'c-none', amountCents: -6000 });
  assert.equal(res.categoryId, 'c-fees');
  assert.equal(applyRules([{ ...base, amountCents: 6000, amountDirection: 'out', setCategoryId: 'c-fees' }], { merchant: 'BONIFIC.', categoryId: 'c-none', amountCents: 6000 }).categoryId, 'c-none', 'la bonificación de +60 no cae en la regla de gastos de 60');
  // el estado guardado valida los campos nuevos
  const { normalizeState } = await import('./src/logic/state.ts');
  const st = JSON.parse(JSON.stringify(buildSeed())); st.rules = [{ id: 'a', merchantContains: '', amountCents: 500, amountDirection: 'out', setCategoryId: 'c-fuel' }];
  assert.ok(normalizeState(st).ok);
  st.rules = [{ id: 'a', merchantContains: 'x', amountCents: 'cinco' }]; assert.ok(!normalizeState(st).ok);
  st.rules = [{ id: 'a', merchantContains: 'x', amountCents: 5, amountDirection: 'sideways' }]; assert.ok(!normalizeState(st).ok);
}
console.log('reglas con importe ok');

{
  const { filterTransactions, sortTransactions, parseAbsAmount } = await import('./src/logic/txfilter.ts');
  const T = (id, date, amountCents, merchant = 'X', extra = {}) => ({ id, date, amountCents, merchant, notes: '', accountId: 'a1', categoryId: 'c1', splits: [], ...extra });
  const txs = [T('1', '2026-03-01', -5000), T('2', '2026-03-10', 7500), T('3', '2026-03-10', -7500), T('4', '2026-04-01', -100), T('5', '2026-02-15', 120000)];
  const ids = (a) => a.map((t) => t.id).join(',');
  assert.equal(ids(filterTransactions(txs, { type: 'out' })), '1,3,4'); assert.equal(ids(filterTransactions(txs, { type: 'in' })), '2,5');
  assert.equal(ids(filterTransactions(txs, { from: '2026-03-01', to: '2026-03-10' })), '1,2,3', 'rango de fechas inclusivo');
  assert.equal(ids(filterTransactions(txs, { from: '2026-03-10' })), '2,3,4'); assert.equal(ids(filterTransactions(txs, { to: '2026-02-28' })), '5');
  assert.equal(ids(filterTransactions(txs, { minCents: 5000, maxCents: 7500 })), '1,2,3', 'importe sin signo, límites inclusivos');
  assert.equal(ids(filterTransactions(txs, { type: 'out', minCents: 5000 })), '1,3'); assert.equal(ids(filterTransactions(txs, { minCents: 200000 })), '');
  assert.equal(ids(sortTransactions(txs, 'amount-desc')), '5,2,3,1,4', 'mayor importe primero; empate por fecha reciente'); // 2 y 3 empatan, mismo día: estable
  assert.equal(ids(sortTransactions(txs, 'amount-asc')), '4,1,2,3,5'); assert.equal(ids(sortTransactions(txs, 'date-asc')), '5,1,2,3,4'); assert.equal(ids(sortTransactions(txs, 'date-desc')), '4,2,3,1,5');
  assert.equal(ids(txs), '1,2,3,4,5', 'no modifica la lista original');
  assert.equal(parseAbsAmount(''), undefined); assert.equal(parseAbsAmount('12,5'), 1250); assert.equal(parseAbsAmount('-3'), 300); assert.equal(parseAbsAmount('abc'), null);
}
console.log('filtros de movimientos ok');

{
  const { rulesChanges } = await import('./src/logic/importer.ts');
  const T = (id, merchant, amountCents, categoryId = 'c-none', splits = []) => ({ id, date: '2026-03-01', merchant, amountCents, notes: '', accountId: 'a1', categoryId, splits });
  const rules = [{ id: 'r1', merchantContains: 'prestamos', setCategoryId: 'c-loan' }, { id: 'r2', merchantContains: '', amountCents: 6000, amountDirection: 'out', setCategoryId: 'c-fees', renameTo: 'Comisión' }];
  const txs = [T('1', 'PRESTAMOS CUOTA', -12475), T('2', 'PRESTAMOS CUOTA', -12475, 'c-loan'), T('3', 'Otra cosa', -6000, 'c-groceries'), T('4', 'Otra cosa', 6000), T('5', 'PRESTAMOS X', -100, 'c-none', [{ categoryId: 'c-a', amountCents: -50 }, { categoryId: 'c-b', amountCents: -50 }])];
  const ch = rulesChanges(rules, txs);
  assert.deepEqual(ch.map((c) => c.id), ['1', '3'], 'solo los que cambian; la regla de importe respeta la dirección; las divididas no cambian de categoría');
  assert.equal(ch[0].categoryId, 'c-loan'); assert.equal(ch[1].merchant, 'Comisión'); assert.equal(ch[1].categoryId, 'c-fees');
  assert.equal(rulesChanges(rules, txs.map((t) => ({ ...t, ...(ch.find((c) => c.id === t.id) ?? {}) }))).length, 0, 'aplicar dos veces no cambia nada más');
  assert.equal(rulesChanges([], txs).length, 0);

  // recurrentes: traspasos
  const { detectRecurring } = await import('./src/logic/recurring.ts');
  const base = JSON.parse(JSON.stringify(buildSeed())); base.transactions = []; base.recurring = [];
  const mk = (id, date, amt, merchant, acc, cat) => ({ id, date, amountCents: amt, merchant, notes: '', accountId: acc, categoryId: cat, splits: [] });
  const months = ['2026-05-15', '2026-06-15', '2026-07-17', '2026-08-14', '2026-09-15', '2026-10-15'];
  const withT = (mut) => ({ ...base, transactions: [...months.flatMap((d, i) => [mk('o' + i, d, -80000, 'Traspaso a ahorro', 'a-check', 'c-transfer'), mk('i' + i, d, 80000, 'Traspaso desde corriente', 'a-save', 'c-transfer')]), ...mut] });
  let det = detectRecurring(withT([]));
  assert.equal(det.length, 1, 'un solo traspaso recurrente (la entrada es el mismo movimiento)'); assert.equal(det[0].amountCents, -80000); assert.equal(det[0].accountId, 'a-check');
  // importe distinto un mes → ya no es el mismo traspaso
  const diff = withT([]); diff.transactions[4] = { ...diff.transactions[4], amountCents: -80100 };
  assert.equal(detectRecurring(diff).length, 0, 'los traspasos exigen el mismo importe exacto');
  // día muy distinto → no
  const far = withT([]); far.transactions[6] = { ...far.transactions[6], date: '2026-07-24' };
  assert.equal(detectRecurring(far).length, 0, 'más de 2 días de diferencia no vale');
  // un pago de tarjeta de importe variable no sale
  const card = { ...base, transactions: months.map((d, i) => mk('c' + i, d, -(30000 + i * 1500), 'Pago de tarjeta', 'a-check', 'c-transfer')) };
  assert.equal(detectRecurring(card).length, 0, 'importes variables no son traspaso recurrente');
}
console.log('reglas a todo y traspasos recurrentes ok');
