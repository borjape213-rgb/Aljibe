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
