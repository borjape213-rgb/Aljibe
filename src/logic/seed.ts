import type { State, Transaction, PricePoint, Category, CategoryGroup } from './types.ts';
import { addDays, addMonths, daysInMonth, iso, monthStart, parse, todayISO, weekdayMon0 } from './dates.ts';

/** PRNG determinista: los mismos datos de ejemplo en cada arranque. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GROUPS: CategoryGroup[] = [
  { id: 'g-income', name: 'Ingresos', kind: 'income', bucket: null },
  { id: 'g-home', name: 'Casa', kind: 'expense', bucket: 'fixed' },
  { id: 'g-bills', name: 'Suscripciones y servicios', kind: 'expense', bucket: 'fixed' },
  { id: 'g-food', name: 'Comida', kind: 'expense', bucket: 'flexible' },
  { id: 'g-move', name: 'Transporte', kind: 'expense', bucket: 'flexible' },
  { id: 'g-life', name: 'Ocio y compras', kind: 'expense', bucket: 'flexible' },
  { id: 'g-health', name: 'Salud', kind: 'expense', bucket: 'nonmonthly' },
  { id: 'g-yearly', name: 'Gastos anuales', kind: 'expense', bucket: 'nonmonthly' },
  { id: 'g-transfer', name: 'Traspasos', kind: 'transfer', bucket: null },
];
export const CATEGORIES: Category[] = [
  { id: 'c-salary', groupId: 'g-income', name: 'Nómina', icon: 'wallet' },
  { id: 'c-otherinc', groupId: 'g-income', name: 'Otros ingresos', icon: 'plus' },
  { id: 'c-rent', groupId: 'g-home', name: 'Alquiler', icon: 'home' },
  { id: 'c-utilities', groupId: 'g-home', name: 'Luz y agua', icon: 'zap' },
  { id: 'c-internet', groupId: 'g-bills', name: 'Internet y móvil', icon: 'wifi' },
  { id: 'c-subs', groupId: 'g-bills', name: 'Suscripciones', icon: 'repeat' },
  { id: 'c-groceries', groupId: 'g-food', name: 'Supermercado', icon: 'cart' },
  { id: 'c-eating', groupId: 'g-food', name: 'Restaurantes y café', icon: 'coffee' },
  { id: 'c-fuel', groupId: 'g-move', name: 'Combustible', icon: 'fuel' },
  { id: 'c-transit', groupId: 'g-move', name: 'Transporte público', icon: 'bus' },
  { id: 'c-fun', groupId: 'g-life', name: 'Ocio', icon: 'ticket' },
  { id: 'c-shopping', groupId: 'g-life', name: 'Compras', icon: 'bag' },
  { id: 'c-pharmacy', groupId: 'g-health', name: 'Farmacia y salud', icon: 'heart' },
  { id: 'c-insurance', groupId: 'g-yearly', name: 'Seguros', icon: 'shield' },
  { id: 'c-transfer', groupId: 'g-transfer', name: 'Traspaso', icon: 'swap' },
  { id: 'c-none', groupId: 'g-life', name: 'Sin categoría', icon: 'help' },
];

export function buildSeed(now = new Date()): State {
  const today = todayISO(now);
  const rnd = mulberry32(20261025);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const txs: Transaction[] = [];
  let n = 0;
  const add = (accountId: string, date: string, cents: number, merchant: string, categoryId: string, extra: Partial<Transaction> = {}) => {
    if (date > today) return;
    txs.push({ id: `t${++n}`, accountId, date, amountCents: Math.round(cents), merchant, categoryId, notes: '', tags: [], pending: false, hidden: false, needsReview: false, splits: [], ...extra });
  };

  const thisMonth = monthStart(today);
  for (let k = 8; k >= 0; k--) {
    const month = addMonths(thisMonth, -k);
    const { y, m } = parse(month);
    const dim = daysInMonth(month);
    const day = (d: number) => iso(y, m, Math.min(d, dim));
    add('a-check', day(28), 245000, 'Empresa Aurora', 'c-salary');
    add('a-check', day(3), -78000, 'Alquiler piso', 'c-rent');
    add('a-check', day(8), -Math.round(between(4800, 7600)), 'Electra Luz', 'c-utilities');
    add('a-check', day(12), -3990, 'Fibra Hogar', 'c-internet');
    add('a-check', day(12), -1200, 'Móvil Libre', 'c-internet');
    add('a-card', day(15), -2990, 'Gimnasio Fuerte', 'c-subs');
    add('a-card', day(18), -1199, 'Streaming Uno', 'c-subs');
    add('a-check', day(27), -30000, 'Traspaso a ahorro', 'c-transfer');
    add('a-save', day(27), 30000, 'Traspaso desde corriente', 'c-transfer');
    if (m === 3 || m === 9) add('a-check', day(10), -41500, 'Seguros Meridiano', 'c-insurance');
    if (rnd() < 0.4) add('a-check', day(20), Math.round(between(2000, 9000)), 'Venta de segunda mano', 'c-otherinc');
    for (let i = 0; i < 9; i++) add('a-card', day(1 + Math.floor(rnd() * 27)), -Math.round(between(1800, 9500)), pick(['Súper Girasol', 'Mercado del Barrio', 'Panadería La Espiga']), 'c-groceries');
    for (let i = 0; i < 6; i++) add('a-card', day(1 + Math.floor(rnd() * 27)), -Math.round(between(450, 4800)), pick(['Café Plaza', 'Taberna Los Naranjos', 'Bar Esquina']), 'c-eating');
    for (let i = 0; i < 2; i++) add('a-card', day(1 + Math.floor(rnd() * 27)), -Math.round(between(3500, 6500)), 'Gasolinera Ruta 4', 'c-fuel');
    add('a-card', day(2), -4000, 'Transporte Urbano', 'c-transit');
    for (let i = 0; i < 2; i++) add('a-card', day(1 + Math.floor(rnd() * 27)), -Math.round(between(900, 4500)), pick(['Cine Alameda', 'Librería Siete', 'Entradas Teatro']), 'c-fun');
    if (rnd() < 0.7) add('a-card', day(1 + Math.floor(rnd() * 27)), -Math.round(between(2500, 11000)), pick(['Moda Calle Larga', 'Tienda del Hogar']), 'c-shopping');
    if (rnd() < 0.5) add('a-card', day(1 + Math.floor(rnd() * 27)), -Math.round(between(600, 3200)), 'Farmacia Central', 'c-pharmacy');
    // pago de la tarjeta: traspaso entre cuentas
    add('a-check', day(5), -Math.round(between(30000, 40000)), 'Pago de tarjeta', 'c-transfer');
  }
  txs.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1));
  // los últimos 3 días: pendientes y por revisar; uno sin categoría
  txs.slice(0, 4).forEach((t) => (t.pending = true));
  txs.slice(0, 9).forEach((t) => (t.needsReview = true));
  if (txs[2]) { txs[2].categoryId = 'c-none'; txs[2].notes = 'No recuerdo qué era'; }
  // una compra dividida de ejemplo
  const big = txs.find((t) => t.categoryId === 'c-groceries' && t.amountCents < -6000 && !t.pending);
  if (big) {
    const a = Math.round(big.amountCents * 0.7);
    big.splits = [{ categoryId: 'c-groceries', amountCents: a }, { categoryId: 'c-pharmacy', amountCents: big.amountCents - a, note: 'Productos de farmacia' }];
  }

  // precios: paseo aleatorio por valor, 400 días
  const days = 400;
  const walk = (start: number, drift: number, vol: number): PricePoint[] => {
    let p = start;
    const out: PricePoint[] = [];
    for (let i = days; i >= 0; i--) {
      const date = addDays(today, -i);
      if (weekdayMon0(date) < 5) p = Math.max(0.5, p * (1 + drift + (rnd() - 0.5) * vol));
      out.push({ date, price: Math.round(p * 10000) / 10000 });
    }
    return out;
  };
  const prices = {
    's-world': walk(100, 0.0003, 0.012),
    's-eur': walk(50, 0.00015, 0.008),
    's-bond': walk(20, 0.00005, 0.002),
    's-tech': walk(30, 0.0005, 0.02),
  };

  return {
    version: 1,
    settings: { currency: 'EUR', locale: 'es-ES', theme: 'system', navItems: ['dashboard', 'accounts', 'transactions', 'cashflow', 'budget', 'recurring', 'investments'], dashboardWidgets: [{ id: 'networth', visible: true }, { id: 'budget', visible: true }, { id: 'recent', visible: true }, { id: 'invest', visible: true }, { id: 'recurring', visible: true }, { id: 'monthreview', visible: true }] },
    accounts: [
      { id: 'a-check', name: 'Cuenta corriente', group: 'cash', subtype: 'Cuenta corriente', balanceCents: 318450, currency: 'EUR', hidden: false, updatedAt: `${today}T08:00:00` },
      { id: 'a-save', name: 'Cuenta de ahorro', group: 'cash', subtype: 'Ahorro', balanceCents: 1204000, currency: 'EUR', hidden: false, updatedAt: `${today}T08:00:00` },
      { id: 'a-card', name: 'Tarjeta personal', group: 'credit', subtype: 'Tarjeta de crédito', balanceCents: -64210, currency: 'EUR', hidden: false, updatedAt: `${today}T08:00:00` },
      { id: 'a-car-loan', name: 'Préstamo del coche', group: 'loans', subtype: 'Préstamo', balanceCents: -640000, currency: 'EUR', hidden: false, updatedAt: `${addDays(today, -20)}T10:00:00` },
      { id: 'a-fund', name: 'Cartera de fondos', group: 'investments', subtype: 'Fondos', balanceCents: 0, currency: 'EUR', hidden: false, updatedAt: `${today}T08:00:00` },
      { id: 'a-pension', name: 'Plan de pensiones', group: 'investments', subtype: 'Jubilación', balanceCents: 0, currency: 'EUR', hidden: false, updatedAt: `${today}T08:00:00` },
      { id: 'a-home', name: 'Vivienda', group: 'assets', subtype: 'Inmueble', balanceCents: 18500000, currency: 'EUR', hidden: false, updatedAt: `${addDays(today, -60)}T10:00:00`, valuations: [{ date: addDays(today, -400), cents: 17600000 }, { date: addDays(today, -200), cents: 18100000 }, { date: addDays(today, -60), cents: 18500000 }] },
      { id: 'a-car', name: 'Coche', group: 'assets', subtype: 'Vehículo', balanceCents: 950000, currency: 'EUR', hidden: false, updatedAt: `${addDays(today, -90)}T10:00:00`, valuations: [{ date: addDays(today, -400), cents: 1250000 }, { date: addDays(today, -90), cents: 950000 }] },
    ],
    groups: GROUPS,
    categories: CATEGORIES,
    tags: [{ id: 'tg-tax', name: 'Hacienda' }, { id: 'tg-reimb', name: 'Reembolsable' }, { id: 'tg-work', name: 'Trabajo' }],
    transactions: txs,
    budgetItems: [],
    rollovers: [{ categoryId: 'c-insurance', enabled: true, startMonth: addMonths(thisMonth, -8), startingBalanceCents: 0 }, { categoryId: 'c-pharmacy', enabled: true, startMonth: addMonths(thisMonth, -3), startingBalanceCents: 0 }],
    rules: [{ id: 'r1', merchantContains: 'gasolinera', setCategoryId: 'c-fuel' }, { id: 'r2', merchantContains: 'electra', renameTo: 'Electra Luz' }],
    recurring: [
      { id: 'rc1', name: 'Alquiler piso', amountCents: -78000, frequency: 'monthly', dayOfMonth: 3, categoryId: 'c-rent', accountId: 'a-check', status: 'active' },
      { id: 'rc2', name: 'Electra Luz', amountCents: -6200, frequency: 'monthly', dayOfMonth: 8, categoryId: 'c-utilities', accountId: 'a-check', status: 'active' },
      { id: 'rc3', name: 'Fibra Hogar', amountCents: -3990, frequency: 'monthly', dayOfMonth: 12, categoryId: 'c-internet', accountId: 'a-check', status: 'active' },
      { id: 'rc4', name: 'Móvil Libre', amountCents: -1200, frequency: 'monthly', dayOfMonth: 12, categoryId: 'c-internet', accountId: 'a-check', status: 'active' },
      { id: 'rc5', name: 'Gimnasio Fuerte', amountCents: -2990, frequency: 'monthly', dayOfMonth: 15, categoryId: 'c-subs', accountId: 'a-card', status: 'active' },
      { id: 'rc6', name: 'Streaming Uno', amountCents: -1199, frequency: 'monthly', dayOfMonth: 18, categoryId: 'c-subs', accountId: 'a-card', status: 'active' },
      { id: 'rc7', name: 'Empresa Aurora', amountCents: 245000, frequency: 'monthly', dayOfMonth: 28, categoryId: 'c-salary', accountId: 'a-check', status: 'active' },
      { id: 'rc8', name: 'Seguros Meridiano', amountCents: -41500, frequency: 'yearly', dayOfMonth: 10, month: 3, categoryId: 'c-insurance', accountId: 'a-check', status: 'active' },
      { id: 'rc9', name: 'Transporte Urbano', amountCents: -4000, frequency: 'monthly', dayOfMonth: 2, categoryId: 'c-transit', accountId: 'a-card', status: 'pending-approval' },
    ],
    securities: [
      { id: 's-world', ticker: 'FMI', name: 'Fondo Mundo Índice', assetClass: 'equity' },
      { id: 's-eur', ticker: 'FEU', name: 'Fondo Europa Dividendo', assetClass: 'equity' },
      { id: 's-bond', ticker: 'BEC', name: 'Bono Euro Corto', assetClass: 'bonds' },
      { id: 's-tech', ticker: 'FTI', name: 'Fondo Tecnología Innova', assetClass: 'equity' },
    ],
    prices,
    holdings: [
      { id: 'h1', accountId: 'a-fund', securityId: 's-world', quantity: 85.5, costBasisCents: 780000 },
      { id: 'h2', accountId: 'a-fund', securityId: 's-eur', quantity: 60, costBasisCents: 280000 },
      { id: 'h3', accountId: 'a-fund', securityId: 's-tech', quantity: 40, costBasisCents: 100000 },
      { id: 'h4', accountId: 'a-pension', securityId: 's-world', quantity: 40, costBasisCents: 340000 },
      { id: 'h5', accountId: 'a-pension', securityId: 's-bond', quantity: 120, costBasisCents: null },
    ],
    benchmarks: [
      { id: 'b-global', name: 'Índice global de ejemplo', series: walk(1000, 0.00028, 0.01) },
      { id: 'b-eur', name: 'Índice europeo de ejemplo', series: walk(500, 0.0002, 0.009) },
    ],
    seededAt: today,
  };
}
