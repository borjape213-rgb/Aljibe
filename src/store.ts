import { useSyncExternalStore } from 'react';
import type { State, Transaction } from './logic/types.ts';
import { buildSeed } from './logic/seed.ts';
import { defaultBudgets } from './logic/budget.ts';
import { addMonths, monthStart, todayISO } from './logic/dates.ts';

const wantsDemo = () => { try { return new URLSearchParams(location.search).get('demo') === '1'; } catch { return false; } };

const DB = 'aljibe', STORE = 'kv', KEY = 'state';
let state: State | null = null;
const listeners = new Set<() => void>();
let persistError: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbGet(): Promise<State | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(KEY);
    r.onsuccess = () => res((r.result as State) ?? null);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(s: State): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(s, KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export function freshSeed(): State {
  const s = buildSeed();
  const m = monthStart(todayISO());
  s.budgetItems = defaultBudgets(s, addMonths(m, -8), addMonths(m, 1));
  return s;
}
export function emptyState(settings?: State['settings']): State {
  const seed = buildSeed();
  return { ...seed, accounts: [], transactions: [], budgetItems: [], rollovers: [], recurring: [], holdings: [], prices: {}, securities: [], benchmarks: [], rules: [], settings: settings ?? seed.settings, seededAt: null };
}

/** Quita la marca "por revisar" que guardaban las versiones anteriores en cada transacción. */
export function dropLegacyReview(st: State): State {
  if (!st.transactions.some((t) => 'needsReview' in t)) return st;
  return { ...st, transactions: st.transactions.map((t) => { const { needsReview: _drop, ...rest } = t as Transaction & { needsReview?: boolean }; return rest; }) };
}

export async function init(): Promise<State> {
  try {
    const saved = await idbGet();
    if (saved && saved.version === 1) {
      state = dropLegacyReview(saved);
      if (state !== saved) void idbSet(state).catch(() => { persistError = 'No se puede guardar en este navegador; los datos se perderán al cerrar.'; });
      return state;
    }
  } catch (e) {
    persistError = 'No se puede guardar en este navegador; los datos se perderán al cerrar.';
  }
  state = wantsDemo() ? freshSeed() : emptyState();
  state.settings = { ...state.settings, createdAt: todayISO() };
  void idbSet(state).catch(() => { persistError = 'No se puede guardar en este navegador; los datos se perderán al cerrar.'; });
  return state;
}

function schedulePersist() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try { if (state) await idbSet(state); persistError = null; }
    catch { persistError = 'No se ha podido guardar. Haz una copia de seguridad.'; }
    listeners.forEach((l) => l());
  }, 150);
}

if (typeof window !== 'undefined') {
  const flush = () => { if (state) { clearTimeout(timer); void idbSet(state).catch(() => {}); } };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

export const getState = (): State => {
  if (!state) throw new Error('El almacén no está iniciado');
  return state;
};
export const getPersistError = () => persistError;
export function setState(next: State) {
  state = next;
  schedulePersist();
  listeners.forEach((l) => l());
}
export function mutate(fn: (s: State) => State) { setState(fn(getState())); }
export function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
export const useData = (): State => useSyncExternalStore(subscribe, getState);
export const usePersistError = () => useSyncExternalStore(subscribe, getPersistError);
