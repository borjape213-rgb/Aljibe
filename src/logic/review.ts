import type { Id, Transaction } from './types.ts';

/** Movimiento que aún necesita categoría: sin categoría, visible y sin dividir. */
export const needsCategory = (t: Transaction) => t.categoryId === 'c-none' && !t.hidden && !t.splits.length;

/**
 * Cola para ir categorizando: primero los que no has saltado, en el orden de la lista, y al final los saltados
 * en el orden en que los fuiste saltando (el último saltado va el último).
 */
export function categorizeQueue(txs: Transaction[], skipped: Id[]): Transaction[] {
  const todo = txs.filter(needsCategory);
  const skip = new Set(skipped);
  const byId = new Map(todo.map((t) => [t.id, t] as const));
  return [...todo.filter((t) => !skip.has(t.id)), ...skipped.map((id) => byId.get(id)).filter((t): t is Transaction => !!t)];
}
