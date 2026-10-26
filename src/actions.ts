import type { Account, Id, RecurringStream, Split, State, Transaction } from './logic/types.ts';
import { getState, mutate, setState, freshSeed, emptyState } from './store.ts';
import { applyRules, planImport, type ImportRow } from './logic/importer.ts';
import { monthStart } from './logic/dates.ts';

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export class ValidationError extends Error {}

export async function createTransaction(input: { accountId: Id; date: string; amountCents: number; merchant: string; categoryId: Id; notes?: string }): Promise<Transaction> {
  if (!input.merchant.trim()) throw new ValidationError('Escribe un comerciante.');
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) throw new ValidationError('El importe no puede ser cero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError('La fecha no es válida.');
  const s = getState();
  const ruled = applyRules(s.rules, { merchant: input.merchant.trim(), categoryId: input.categoryId });
  const t: Transaction = { id: uid('t'), accountId: input.accountId, date: input.date, amountCents: input.amountCents, merchant: ruled.merchant, categoryId: ruled.categoryId, notes: input.notes ?? '', tags: [], pending: false, hidden: false, needsReview: false, splits: [] };
  const acc = s.accounts.find((a) => a.id === input.accountId);
  mutate((st) => ({ ...st, transactions: [t, ...st.transactions].sort(byDateDesc), accounts: st.accounts.map((a) => (a.id === input.accountId && a.group !== 'investments' ? { ...a, balanceCents: a.balanceCents + t.amountCents } : a)) }));
  void acc;
  return t;
}
const byDateDesc = (a: Transaction, b: Transaction) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1);

export async function updateTransactions(ids: Id[], patch: Partial<Pick<Transaction, 'categoryId' | 'merchant' | 'notes' | 'tags' | 'hidden' | 'needsReview' | 'date'>>): Promise<void> {
  const set = new Set(ids);
  mutate((s) => ({
    ...s,
    transactions: s.transactions.map((t) => {
      if (!set.has(t.id)) return t;
      const next = { ...t, ...patch };
      // si cambia la categoría de una transacción dividida, se deshace la división
      if (patch.categoryId && t.splits.length) next.splits = [];
      return next;
    }).sort(byDateDesc),
  }));
}

export async function setSplits(id: Id, splits: Split[]): Promise<void> {
  const t = getState().transactions.find((x) => x.id === id);
  if (!t) throw new ValidationError('No existe la transacción.');
  if (splits.length === 1) throw new ValidationError('Una división necesita al menos dos partes.');
  if (splits.length > 0) {
    const sum = splits.reduce((n, p) => n + p.amountCents, 0);
    if (sum !== t.amountCents) throw new ValidationError('Las partes no suman el importe de la transacción.');
    if (splits.some((p) => p.amountCents === 0 || Math.sign(p.amountCents) !== Math.sign(t.amountCents))) throw new ValidationError('Cada parte debe tener el mismo signo que el total y no ser cero.');
  }
  mutate((s) => ({ ...s, transactions: s.transactions.map((x) => (x.id === id ? { ...x, splits, categoryId: splits[0]?.categoryId ?? x.categoryId } : x)) }));
}

export async function deleteTransaction(id: Id): Promise<void> {
  const t = getState().transactions.find((x) => x.id === id);
  if (!t) return;
  mutate((s) => ({ ...s, transactions: s.transactions.filter((x) => x.id !== id), accounts: s.accounts.map((a) => (a.id === t.accountId && a.group !== 'investments' ? { ...a, balanceCents: a.balanceCents - t.amountCents } : a)) }));
}

export async function setBudget(categoryId: Id, month: string, amountCents: number, applyForward = false): Promise<void> {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new ValidationError('El presupuesto debe ser un importe positivo.');
  mutate((s) => {
    const months = applyForward ? [...new Set(s.budgetItems.filter((b) => b.month >= month).map((b) => b.month).concat(month))] : [month];
    const rest = s.budgetItems.filter((b) => !(b.categoryId === categoryId && months.includes(b.month)));
    return { ...s, budgetItems: [...rest, ...months.map((m) => ({ categoryId, month: m, amountCents }))] };
  });
}
export async function setRollover(categoryId: Id, enabled: boolean, month: string, startingBalanceCents = 0): Promise<void> {
  mutate((s) => {
    const others = s.rollovers.filter((r) => r.categoryId !== categoryId);
    const prev = s.rollovers.find((r) => r.categoryId === categoryId);
    return { ...s, rollovers: [...others, { categoryId, enabled, startMonth: prev?.enabled ? prev.startMonth : monthStart(month), startingBalanceCents: prev?.enabled ? prev.startingBalanceCents : startingBalanceCents }] };
  });
}

export async function saveAccount(a: Omit<Account, 'id' | 'updatedAt'> & { id?: Id }): Promise<Id> {
  if (!a.name.trim()) throw new ValidationError('Escribe un nombre para la cuenta.');
  const id = a.id ?? uid('a');
  const now = new Date().toISOString();
  mutate((s) => {
    const full: Account = { ...a, id, updatedAt: now, name: a.name.trim() };
    const exists = s.accounts.some((x) => x.id === id);
    return { ...s, accounts: exists ? s.accounts.map((x) => (x.id === id ? { ...x, ...full, valuations: x.group === 'assets' ? [...(x.valuations ?? []).filter((v) => v.date !== now.slice(0, 10)), { date: now.slice(0, 10), cents: full.balanceCents }] : x.valuations } : x)) : [...s.accounts, { ...full, valuations: full.group === 'assets' ? [{ date: now.slice(0, 10), cents: full.balanceCents }] : undefined }] };
  });
  return id;
}
export async function deleteAccount(id: Id): Promise<void> {
  mutate((s) => ({ ...s, accounts: s.accounts.filter((a) => a.id !== id), transactions: s.transactions.filter((t) => t.accountId !== id), holdings: s.holdings.filter((h) => h.accountId !== id), recurring: s.recurring.filter((r) => r.accountId !== id) }));
}

export async function setRecurringStatus(id: Id, status: RecurringStream['status']): Promise<void> {
  mutate((s) => ({ ...s, recurring: s.recurring.map((r) => (r.id === id ? { ...r, status } : r)) }));
}
export async function approveDetected(r: RecurringStream): Promise<void> {
  mutate((s) => ({ ...s, recurring: [...s.recurring.filter((x) => x.id !== r.id), { ...r, id: uid('rc'), status: 'active' }] }));
}

export async function importRows(accountId: Id, rows: ImportRow[]): Promise<{ added: number; skipped: number }> {
  const s = getState();
  const { fresh, skipped } = planImport(s, accountId, rows);
  const news: Transaction[] = fresh.map(({ row, key }) => {
    const r = applyRules(s.rules, { merchant: row.merchant, categoryId: 'c-none' });
    return { id: uid('t'), accountId, date: row.date, amountCents: row.amountCents, merchant: r.merchant, categoryId: r.categoryId, notes: '', tags: [], pending: false, hidden: false, needsReview: true, splits: [], externalId: key };
  });
  const delta = news.reduce((n, t) => n + t.amountCents, 0);
  mutate((st) => ({ ...st, transactions: [...news, ...st.transactions].sort(byDateDesc), accounts: st.accounts.map((a) => (a.id === accountId && a.group !== 'investments' ? { ...a, balanceCents: a.balanceCents + delta } : a)) }));
  return { added: news.length, skipped };
}

export async function updateSettings(patch: Partial<State['settings']>) { mutate((s) => ({ ...s, settings: { ...s.settings, ...patch } })); }
export async function addRule(r: { merchantContains: string; setCategoryId?: Id; renameTo?: string }) {
  if (!r.merchantContains.trim()) throw new ValidationError('Escribe el texto que debe contener el comerciante.');
  if (!r.setCategoryId && !r.renameTo) throw new ValidationError('Elige una categoría o un nombre nuevo.');
  mutate((s) => ({ ...s, rules: [...s.rules, { id: uid('r'), ...r }] }));
}
export async function removeRule(id: Id) { mutate((s) => ({ ...s, rules: s.rules.filter((r) => r.id !== id) })); }
export async function saveCategory(c: { id?: Id; groupId: Id; name: string }) {
  if (!c.name.trim()) throw new ValidationError('Escribe un nombre.');
  mutate((s) => ({ ...s, categories: c.id ? s.categories.map((x) => (x.id === c.id ? { ...x, name: c.name.trim(), groupId: c.groupId } : x)) : [...s.categories, { id: uid('c'), groupId: c.groupId, name: c.name.trim(), icon: 'tag' }] }));
}
export async function deleteCategory(id: Id) {
  mutate((s) => ({ ...s, categories: s.categories.filter((c) => c.id !== id), transactions: s.transactions.map((t) => ({ ...t, categoryId: t.categoryId === id ? 'c-none' : t.categoryId, splits: t.splits.map((p) => ({ ...p, categoryId: p.categoryId === id ? 'c-none' : p.categoryId })) })), budgetItems: s.budgetItems.filter((b) => b.categoryId !== id) }));
}
export async function addTag(name: string) { if (!name.trim()) throw new ValidationError('Escribe un nombre.'); mutate((s) => ({ ...s, tags: [...s.tags, { id: uid('tg'), name: name.trim() }] })); }
export async function removeTag(id: Id) { mutate((s) => ({ ...s, tags: s.tags.filter((t) => t.id !== id), transactions: s.transactions.map((t) => ({ ...t, tags: t.tags.filter((x) => x !== id) })) })); }

export function exportJSON(): string { return JSON.stringify(getState()); }
export async function markBackup() { mutate((s) => ({ ...s, settings: { ...s.settings, lastBackupAt: new Date().toISOString() } })); }
export async function moveItem(kind: 'widgets' | 'nav', index: number, delta: -1 | 1) {
  mutate((s) => {
    const list = kind === 'widgets' ? [...s.settings.dashboardWidgets] : [...s.settings.navItems];
    const j = index + delta;
    if (j < 0 || j >= list.length) return s;
    [list[index], list[j]] = [list[j], list[index]];
    return { ...s, settings: kind === 'widgets' ? { ...s.settings, dashboardWidgets: list as State['settings']['dashboardWidgets'] } : { ...s.settings, navItems: list as string[] } };
  });
}
export async function importJSON(text: string): Promise<void> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ValidationError('El archivo no es una copia de seguridad válida.'); }
  const p = parsed as State;
  if (!p || p.version !== 1 || !Array.isArray(p.accounts) || !Array.isArray(p.transactions) || !Array.isArray(p.categories)) throw new ValidationError('El archivo no es una copia de seguridad válida.');
  setState(p);
}
export async function resetSeed() { setState(freshSeed()); }
export async function clearAll() { setState(emptyState(getState().settings)); }

export async function copyBudget(fromMonth: string, toMonth: string): Promise<number> {
  const src = getState().budgetItems.filter((b) => b.month === fromMonth);
  if (!src.length) throw new ValidationError('El mes anterior no tiene presupuesto que copiar.');
  mutate((s) => ({ ...s, budgetItems: [...s.budgetItems.filter((b) => b.month !== toMonth), ...src.map((b) => ({ ...b, month: toMonth }))] }));
  return src.length;
}

export async function saveHolding(h: { id?: Id; accountId: Id; securityId: Id; quantity: number; costBasisCents: number | null }): Promise<void> {
  if (!(h.quantity > 0)) throw new ValidationError('La cantidad debe ser mayor que cero.');
  if (h.costBasisCents !== null && h.costBasisCents < 0) throw new ValidationError('El coste no puede ser negativo.');
  mutate((s) => ({ ...s, holdings: h.id ? s.holdings.map((x) => (x.id === h.id ? { ...x, ...h, id: h.id! } : x)) : [...s.holdings, { id: uid('h'), accountId: h.accountId, securityId: h.securityId, quantity: h.quantity, costBasisCents: h.costBasisCents }] }));
}
export async function removeHolding(id: Id) { mutate((s) => ({ ...s, holdings: s.holdings.filter((h) => h.id !== id) })); }
export async function saveSecurity(x: { ticker: string; name: string; assetClass: State['securities'][number]['assetClass']; price: number; date: string }): Promise<Id> {
  if (!x.name.trim() || !x.ticker.trim()) throw new ValidationError('Escribe nombre y símbolo.');
  if (!(x.price > 0)) throw new ValidationError('El precio debe ser mayor que cero.');
  const id = uid('s');
  mutate((s) => ({ ...s, securities: [...s.securities, { id, ticker: x.ticker.trim().toUpperCase(), name: x.name.trim(), assetClass: x.assetClass }], prices: { ...s.prices, [id]: [{ date: x.date, price: x.price }] } }));
  return id;
}
export async function addPrice(securityId: Id, date: string, price: number): Promise<void> {
  if (!(price > 0)) throw new ValidationError('El precio debe ser mayor que cero.');
  mutate((s) => ({ ...s, prices: { ...s.prices, [securityId]: [...(s.prices[securityId] ?? []).filter((p) => p.date !== date), { date, price }].sort((a, b) => (a.date < b.date ? -1 : 1)) } }));
}
