import type { Account, Category, CategoryGroup, State, Transaction } from './types.ts';
import { CATEGORIES, GROUPS, buildSeed } from './seed.ts';

/** Resultado de validar un estado leído de disco o de un archivo de copia de seguridad. */
export type Normalized = { ok: true; state: State } | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown) => typeof x === 'string';
const int = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_GROUPS = ['cash', 'credit', 'loans', 'investments', 'assets', 'other'];
const GROUP_KINDS = ['income', 'expense', 'transfer'];
const BUCKETS = ['fixed', 'nonmonthly', 'flexible'];

class Bad extends Error {}
const need = (cond: unknown, msg: string): void => { if (!cond) throw new Bad(msg); };

function list(p: Record<string, unknown>, key: string, required: boolean, label: string): unknown[] {
  const v = p[key];
  if (v === undefined || v === null) { need(!required, `Falta la lista de ${label}.`); return []; }
  need(Array.isArray(v), `La lista de ${label} no es válida.`);
  return v as unknown[];
}

function account(x: unknown, i: number): Account {
  need(isObj(x), `Cuenta ${i + 1}: formato no válido.`);
  const a = x as Record<string, unknown>;
  need(str(a.id) && a.id !== '', `Cuenta ${i + 1}: falta el identificador.`);
  need(str(a.name), `Cuenta ${i + 1}: falta el nombre.`);
  need(str(a.group) && ACCOUNT_GROUPS.includes(a.group as string), `Cuenta «${a.name}»: tipo no válido.`);
  need(int(a.balanceCents), `Cuenta «${a.name}»: saldo no válido.`);
  if (a.valuations !== undefined) need(Array.isArray(a.valuations) && (a.valuations as unknown[]).every((v) => isObj(v) && str(v.date) && int(v.cents)), `Cuenta «${a.name}»: valoraciones no válidas.`);
  return { ...(a as unknown as Account), subtype: str(a.subtype) ? (a.subtype as string) : '', currency: str(a.currency) ? (a.currency as string) : 'EUR', hidden: a.hidden === true, updatedAt: str(a.updatedAt) ? (a.updatedAt as string) : new Date().toISOString().slice(0, 19) };
}

function transaction(x: unknown, i: number): Transaction {
  need(isObj(x), `Movimiento ${i + 1}: formato no válido.`);
  const t = x as Record<string, unknown>;
  need(str(t.id) && t.id !== '', `Movimiento ${i + 1}: falta el identificador.`);
  need(str(t.accountId), `Movimiento ${i + 1}: falta la cuenta.`);
  need(str(t.date) && ISO.test(t.date as string), `Movimiento ${i + 1}: fecha no válida.`);
  need(int(t.amountCents), `Movimiento ${i + 1}: importe no válido.`);
  need(str(t.categoryId), `Movimiento ${i + 1}: falta la categoría.`);
  const splits = t.splits === undefined || t.splits === null ? [] : t.splits;
  need(Array.isArray(splits) && (splits as unknown[]).every((p) => isObj(p) && str(p.categoryId) && int(p.amountCents)), `Movimiento ${i + 1}: la división no es válida.`);
  const tags = t.tags === undefined || t.tags === null ? [] : t.tags;
  need(Array.isArray(tags) && (tags as unknown[]).every(str), `Movimiento ${i + 1}: las etiquetas no son válidas.`);
  const { needsReview: _legacy, ...rest } = t as Record<string, unknown>;
  return { ...(rest as unknown as Transaction), merchant: str(t.merchant) ? (t.merchant as string) : '', notes: str(t.notes) ? (t.notes as string) : '', tags: tags as string[], hidden: t.hidden === true, splits: splits as Transaction['splits'] };
}

function group(x: unknown, i: number): CategoryGroup {
  need(isObj(x), `Grupo ${i + 1}: formato no válido.`);
  const g = x as Record<string, unknown>;
  need(str(g.id) && str(g.name) && str(g.kind) && GROUP_KINDS.includes(g.kind as string), `Grupo ${i + 1}: datos no válidos.`);
  return { id: g.id as string, name: g.name as string, kind: g.kind as CategoryGroup['kind'], bucket: str(g.bucket) && BUCKETS.includes(g.bucket as string) ? (g.bucket as CategoryGroup['bucket']) : null };
}

function category(x: unknown, i: number): Category {
  need(isObj(x), `Categoría ${i + 1}: formato no válido.`);
  const c = x as Record<string, unknown>;
  need(str(c.id) && str(c.groupId) && str(c.name), `Categoría ${i + 1}: datos no válidos.`);
  return { id: c.id as string, groupId: c.groupId as string, name: c.name as string, icon: str(c.icon) ? (c.icon as string) : 'tag' };
}

/** Comprueba que cada elemento de una lista tiene los campos que la app lee sin protegerse. */
function each(items: unknown[], label: string, ok: (r: Record<string, unknown>) => boolean): void {
  items.forEach((x, i) => need(isObj(x) && ok(x), `${label} ${i + 1}: datos no válidos.`));
}

/**
 * Valida un estado leído de IndexedDB o de un archivo de copia de seguridad y lo completa con valores por defecto
 * donde falte algo opcional. Si lo esencial no cuadra (versión, cuentas, movimientos, categorías) no lo arregla:
 * devuelve el motivo para que quien llama no sustituya datos buenos por datos rotos.
 */
export function normalizeState(raw: unknown): Normalized {
  try {
    need(isObj(raw), 'El archivo no es una copia de seguridad de Aljibe.');
    const p = raw as Record<string, unknown>;
    need(p.version === 1, p.version === undefined ? 'El archivo no es una copia de seguridad de Aljibe.' : `Versión de datos no reconocida (${String(p.version)}); esta app solo entiende la 1.`);
    const accounts = list(p, 'accounts', true, 'cuentas').map(account);
    const transactions = list(p, 'transactions', true, 'movimientos').map(transaction);
    const categories = list(p, 'categories', true, 'categorías').map(category);
    const groups = p.groups === undefined || p.groups === null ? GROUPS.map((g) => ({ ...g })) : list(p, 'groups', true, 'grupos').map(group);
    const seed = buildSeed();
    const settings = { ...seed.settings, ...(isObj(p.settings) ? p.settings : {}) } as State['settings'];
    need(str(settings.currency) && str(settings.locale), 'Los ajustes no son válidos.');
    if (!['system', 'light', 'dark'].includes(settings.theme)) settings.theme = 'system';
    if (!Array.isArray(settings.navItems) || !settings.navItems.every(str)) settings.navItems = seed.settings.navItems;
    if (!Array.isArray(settings.dashboardWidgets) || !settings.dashboardWidgets.every((w) => isObj(w) && str(w.id))) settings.dashboardWidgets = seed.settings.dashboardWidgets;

    const tags = list(p, 'tags', false, 'etiquetas'); each(tags, 'Etiqueta', (r) => str(r.id) && str(r.name));
    const budgetItems = list(p, 'budgetItems', false, 'presupuestos'); each(budgetItems, 'Presupuesto', (r) => str(r.categoryId) && str(r.month) && int(r.amountCents));
    const rollovers = list(p, 'rollovers', false, 'arrastres'); each(rollovers, 'Arrastre', (r) => str(r.categoryId) && typeof r.enabled === 'boolean' && str(r.startMonth) && int(r.startingBalanceCents));
    const rules = list(p, 'rules', false, 'reglas'); each(rules, 'Regla', (r) => str(r.id) && str(r.merchantContains));
    const recurring = list(p, 'recurring', false, 'recurrentes'); each(recurring, 'Recurrente', (r) => str(r.id) && str(r.name) && int(r.amountCents) && int(r.dayOfMonth) && str(r.categoryId) && str(r.accountId) && ['weekly', 'monthly', 'yearly'].includes(r.frequency as string) && ['active', 'cancelled', 'pending-approval'].includes(r.status as string));
    const securities = list(p, 'securities', false, 'valores'); each(securities, 'Valor', (r) => str(r.id) && str(r.ticker) && str(r.name) && str(r.assetClass));
    const holdings = list(p, 'holdings', false, 'posiciones'); each(holdings, 'Posición', (r) => str(r.id) && str(r.accountId) && str(r.securityId) && num(r.quantity) && (r.costBasisCents === null || int(r.costBasisCents)));
    const benchmarks = list(p, 'benchmarks', false, 'índices'); each(benchmarks, 'Índice', (r) => str(r.id) && str(r.name) && Array.isArray(r.series) && (r.series as unknown[]).every((x) => isObj(x) && str(x.date) && num(x.price)));
    const prices = p.prices === undefined || p.prices === null ? {} : p.prices;
    need(isObj(prices) && Object.values(prices).every((s) => Array.isArray(s) && s.every((x) => isObj(x) && str(x.date) && num(x.price))), 'Los precios no son válidos.');

    // la app da por hecho que existe "Sin categoría" y su grupo
    const cats = categories.some((c) => c.id === 'c-none') ? categories : [...categories, { ...CATEGORIES.find((c) => c.id === 'c-none')! }];
    const noneGroup = cats.find((c) => c.id === 'c-none')!.groupId;
    const grps = groups.some((g) => g.id === noneGroup) ? groups : [...groups, ...GROUPS.filter((g) => g.id === noneGroup)];
    need(grps.some((g) => g.id === noneGroup), 'Falta el grupo de «Sin categoría».');

    return {
      ok: true,
      state: {
        version: 1, settings, accounts, groups: grps, categories: cats, tags: tags as State['tags'], transactions,
        budgetItems: budgetItems as State['budgetItems'], rollovers: rollovers as State['rollovers'], rules: rules as State['rules'],
        recurring: recurring as State['recurring'], securities: securities as State['securities'], prices: prices as State['prices'],
        holdings: holdings as State['holdings'], benchmarks: benchmarks as State['benchmarks'],
        seededAt: str(p.seededAt) ? (p.seededAt as string) : null,
      },
    };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    return { ok: false, error: 'No se ha podido leer el archivo.' };
  }
}

/** Resumen para enseñar al usuario qué hay dentro de un estado antes de sustituir otro. */
export const countsOf = (s: State) => ({ accounts: s.accounts.length, transactions: s.transactions.length });
