import { useSyncExternalStore } from 'react';
import type { State, Transaction } from './logic/types.ts';
import { buildSeed } from './logic/seed.ts';
import { defaultBudgets } from './logic/budget.ts';
import { addMonths, monthStart, todayISO } from './logic/dates.ts';
import { normalizeState } from './logic/state.ts';

const wantsDemo = () => { try { return new URLSearchParams(location.search).get('demo') === '1'; } catch { return false; } };

const DB = 'aljibe', STORE = 'kv', KEY = 'state';
let state: State | null = null;
const listeners = new Set<() => void>();
let persistError: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Por qué no se han podido cargar los datos guardados. Mientras haya un bloqueo no se escribe NADA en disco:
 * lo que hay guardado puede ser todo lo que el usuario tiene, y un estado vacío en memoria no debe pisarlo.
 */
export interface StorageLock {
  reason: 'read-error' | 'unreadable';
  detail: string;
  /** Lo que había guardado, tal cual, para poder descargarlo. Null si ni siquiera se pudo leer. */
  raw: unknown | null;
}
let lock: StorageLock | null = null;
/** El usuario ha elegido seguir sin guardar: nada se escribe en disco durante esta sesión. */
let noSave = false;
export const getLock = () => lock;
const canWrite = () => !lock && !noSave;
const NO_SAVE_MSG = 'Estás en modo sin guardar: lo que hagas no se conservará al cerrar. Tus datos guardados no se han tocado.';

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbRead(key: string): Promise<unknown> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror = () => rej(r.error);
  });
}
async function idbWrite(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
const idbGet = () => idbRead(KEY);
const idbSet = (s: State) => idbWrite(KEY, s);

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
  lock = null; noSave = false; persistError = null;
  let saved: unknown;
  try {
    saved = await idbGet();
  } catch (e) {
    // No sabemos si hay datos: no se escribe nada. Si el fallo es transitorio basta con reintentar.
    lock = { reason: 'read-error', detail: e instanceof Error ? e.message : String(e), raw: null };
    state = emptyState();
    return state;
  }
  if (saved !== null) {
    const n = normalizeState(saved);
    if (!n.ok) {
      // Hay algo guardado que esta versión no entiende (otra versión del esquema, datos dañados): se deja intacto.
      lock = { reason: 'unreadable', detail: n.error, raw: saved };
      state = emptyState();
      return state;
    }
    state = dropLegacyReview(n.state);
    if (state !== n.state) void idbSet(state).catch(() => { persistError = 'No se puede guardar en este navegador; los datos se perderán al cerrar.'; });
    return state;
  }
  // Lectura correcta y sin nada guardado: instalación nueva. Solo aquí se escribe un estado inicial.
  state = wantsDemo() ? freshSeed() : emptyState();
  state.settings = { ...state.settings, createdAt: todayISO() };
  void idbSet(state).catch(() => { persistError = 'No se puede guardar en este navegador; los datos se perderán al cerrar.'; });
  // Pide que el navegador no expulse los datos si falta espacio (no hace nada si no lo concede).
  try { void navigator.storage?.persist?.(); } catch { /* sin API de almacenamiento persistente */ }
  return state;
}

/** Sigue usando la app con un estado vacío en memoria, sin escribir nunca en disco. */
export function continueWithoutSaving() {
  noSave = true; lock = null;
  persistError = NO_SAVE_MSG;
  listeners.forEach((l) => l());
}

/** Copia del estado justo antes de una operación que lo sustituye (restaurar, vaciar, cargar ejemplo). */
const PREV_KEY = 'previous';
export interface PreviousCopy { savedAt: string; accounts: number; transactions: number; state: State }
export async function savePreviousCopy(): Promise<void> {
  if (!state || noSave) return; // en modo sin guardar no hay disco que proteger
  const copy: PreviousCopy = { savedAt: new Date().toISOString(), accounts: state.accounts.length, transactions: state.transactions.length, state };
  await idbWrite(PREV_KEY, copy);
}
/** Borra del móvil la copia previa (para quien quiere que "Vaciar todo" no deje nada detrás). */
export async function discardPreviousCopy(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(PREV_KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
export async function loadPreviousCopy(): Promise<PreviousCopy | null> {
  try {
    const raw = (await idbRead(PREV_KEY)) as Partial<PreviousCopy> | null;
    if (!raw || !raw.state) return null;
    const n = normalizeState(raw.state);
    return n.ok ? { savedAt: String(raw.savedAt ?? ''), accounts: n.state.accounts.length, transactions: n.state.transactions.length, state: n.state } : null;
  } catch { return null; }
}

function schedulePersist() {
  if (!canWrite()) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try { if (state) await idbSet(state); persistError = null; }
    catch { persistError = 'No se ha podido guardar. Haz una copia de seguridad.'; }
    listeners.forEach((l) => l());
  }, 150);
}

if (typeof window !== 'undefined') {
  const flush = () => { if (state && canWrite()) { clearTimeout(timer); void idbSet(state).catch(() => {}); } };
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
