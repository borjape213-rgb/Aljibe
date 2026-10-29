/**
 * Actualización de precios bajo demanda. Sin servidor propio: la petición sale del navegador hacia
 *  - Alpha Vantage (TIME_SERIES_DAILY) con la clave gratuita que pega el usuario, y
 *  - Frankfurter (tipos del BCE, sin clave) cuando el activo cotiza en otra moneda.
 * La clave solo existe en memoria durante la sesión: este módulo no la guarda en ningún sitio.
 */
export type QuoteErrorKind = 'no-symbol' | 'rate-limit' | 'provider' | 'not-found' | 'network' | 'fx' | 'bad-data';

export interface QuoteRequest { id: string; symbol: string; currency: string }
export interface QuoteResult {
  id: string;
  ok: boolean;
  /** Fecha del último cierre que devuelve el proveedor. */
  date?: string;
  /** Cierre tal cual, en la moneda del activo. */
  nativePrice?: number;
  /** Precio ya convertido a la moneda base. Es el que se guardaría. */
  price?: number;
  /** Tipo de cambio aplicado (1 unidad de la moneda del activo en moneda base); 1 si no hace falta. */
  rate?: number;
  error?: QuoteErrorKind;
  detail?: string;
}

/** Códigos de bolsa al estilo Google Finance ("AIR:EPA") → sufijo de Alpha Vantage ("AIR.PAR"). */
const EXCHANGE_SUFFIX: Record<string, string> = { EPA: 'PAR', ETR: 'DEX', FRA: 'FRK', LON: 'LON', AMS: 'AMS', EBR: 'BRU', BME: 'MAD', BIT: 'MIL', SWX: 'SWI', STO: 'STO', CPH: 'CPH', HEL: 'HEL', VIE: 'VIE', ELI: 'LIS', TSE: 'TRT', TSX: 'TRT' };

/** "AIR:EPA" → "AIR.PAR". Un símbolo que ya lleva punto, o sin bolsa, se envía tal cual ("AIR.PAR", "AAPL"). */
export function toProviderSymbol(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z0-9.\-]+):([A-Z]{2,5})$/.exec(t);
  if (!m) return t;
  const suffix = EXCHANGE_SUFFIX[m[2]];
  return suffix ? `${m[1]}.${suffix}` : `${m[1]}.${m[2]}`;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: QuoteErrorKind; detail?: string };
const cut = (x: unknown) => String(x ?? '').replace(/\s+/g, ' ').slice(0, 140);

/** Último cierre de la respuesta de TIME_SERIES_DAILY. */
export function parseDaily(json: unknown): Parsed<{ date: string; close: number }> {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const series = o['Time Series (Daily)'];
  if (series && typeof series === 'object') {
    let best: string | null = null;
    for (const d of Object.keys(series)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (best === null || d > best)) best = d;
    const day = best ? (series as Record<string, Record<string, unknown>>)[best] : null;
    const close = day ? Number(day['4. close']) : NaN;
    if (best && Number.isFinite(close) && close > 0) return { ok: true, value: { date: best, close } };
    return { ok: false, error: 'bad-data', detail: 'La respuesta no trae un cierre válido.' };
  }
  const msg = cut(o['Information'] ?? o['Note'] ?? o['Error Message']);
  if (o['Error Message']) return { ok: false, error: 'not-found', detail: msg };
  if (/rate limit|per day|per minute|requests per|premium|spread out/i.test(msg)) return { ok: false, error: 'rate-limit', detail: msg };
  if (msg) return { ok: false, error: 'provider', detail: msg };
  return { ok: false, error: 'bad-data', detail: 'Respuesta inesperada del proveedor.' };
}

/** Tipo de cambio de la respuesta de Frankfurter. Acepta las formas conocidas de la API. */
export function parseFx(json: unknown, quote: string): Parsed<number> {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const cands: unknown[] = [o.rate];
  if (o.rates && typeof o.rates === 'object') { const r = o.rates as Record<string, unknown>; cands.push(r[quote], r[quote.toLowerCase()]); }
  if (Array.isArray(json) && json[0] && typeof json[0] === 'object') cands.push((json[0] as Record<string, unknown>).rate);
  for (const c of cands) { const n = Number(c); if (Number.isFinite(n) && n > 0) return { ok: true, value: n }; }
  return { ok: false, error: 'fx', detail: 'No se ha podido leer el tipo de cambio.' };
}

export interface FetchOptions {
  apiKey: string;
  /** Moneda en la que guarda los precios la app (EUR). */
  base: string;
  items: QuoteRequest[];
  fetchFn?: typeof fetch;
  /** Pausa entre peticiones al proveedor (el plan gratuito limita las peticiones por minuto). */
  gapMs?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const AV = 'https://www.alphavantage.co/query';
const FX = 'https://api.frankfurter.dev/v2/rate';
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => { if (ms <= 0) return res(); const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });
const NET: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };

async function getJson(f: typeof fetch, url: string, signal?: AbortSignal): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  const onAbort = () => ctl.abort(); signal?.addEventListener('abort', onAbort, { once: true });
  try { const r = await f(url, { ...NET, signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

export async function fetchQuotes(o: FetchOptions): Promise<QuoteResult[]> {
  const f = o.fetchFn ?? fetch;
  const out: QuoteResult[] = [];
  const fx = new Map<string, Parsed<number>>();
  let limited = false, first = true;
  for (let i = 0; i < o.items.length; i++) {
    const it = o.items[i];
    o.onProgress?.(i, o.items.length);
    if (o.signal?.aborted) break;
    if (!it.symbol.trim()) { out.push({ id: it.id, ok: false, error: 'no-symbol' }); continue; }
    if (limited) { out.push({ id: it.id, ok: false, error: 'rate-limit', detail: 'No se ha pedido: el proveedor ya había llegado a su límite.' }); continue; }
    if (!first) await sleep(o.gapMs ?? 12500, o.signal);
    if (o.signal?.aborted) break;
    first = false;
    let q: Parsed<{ date: string; close: number }>;
    try { q = parseDaily(await getJson(f, `${AV}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(toProviderSymbol(it.symbol))}&apikey=${encodeURIComponent(o.apiKey)}`, o.signal)); }
    catch (e) { if (o.signal?.aborted) break; out.push({ id: it.id, ok: false, error: 'network', detail: e instanceof Error ? e.message : String(e) }); continue; }
    if (!q.ok) { if (q.error === 'rate-limit') limited = true; out.push({ id: it.id, ok: false, error: q.error, detail: q.detail }); continue; }
    const cur = (it.currency || o.base).toUpperCase(), base = o.base.toUpperCase();
    let rate = 1;
    if (cur !== base) {
      if (!fx.has(cur)) {
        try { fx.set(cur, parseFx(await getJson(f, `${FX}/${cur}/${base}`, o.signal), base)); }
        catch (e) { if (o.signal?.aborted) break; fx.set(cur, { ok: false, error: 'fx', detail: e instanceof Error ? e.message : String(e) }); }
      }
      const r = fx.get(cur)!;
      if (!r.ok) { out.push({ id: it.id, ok: false, error: 'fx', detail: `Sin tipo de cambio ${cur}→${base}.` }); continue; }
      rate = r.value;
    }
    out.push({ id: it.id, ok: true, date: q.value.date, nativePrice: q.value.close, rate, price: Math.round(q.value.close * rate * 1e6) / 1e6 });
  }
  o.onProgress?.(o.items.length, o.items.length);
  return out;
}

export interface PreviewRow { id: string; rate: number; date: string; oldPrice: number | null; newPrice: number; changePct: number | null; suspicious: boolean; stale: boolean }
/** Compara lo obtenido con el último precio guardado. Un salto de más del 30 % o una fecha más antigua se marcan para no aplicarlos sin querer. */
export function previewQuotes(prices: Record<string, { date: string; price: number }[]>, results: QuoteResult[]): PreviewRow[] {
  return results.filter((r) => r.ok && r.price !== undefined && r.date).map((r) => {
    const last = (prices[r.id] ?? []).at(-1) ?? null;
    const changePct = last && last.price > 0 ? (r.price! / last.price - 1) * 100 : null;
    return { id: r.id, rate: r.rate ?? 1, date: r.date!, oldPrice: last?.price ?? null, newPrice: r.price!, changePct, suspicious: changePct !== null && Math.abs(changePct) > 30, stale: !!last && r.date! < last.date };
  });
}

/** Cambio de hoy del BCE (Frankfurter): unidades de `base` por 1 unidad de `cur`. */
export async function fetchRate(cur: string, base: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<Parsed<number>> {
  try { return parseFx(await getJson(fetchFn, `${FX}/${cur.toUpperCase()}/${base.toUpperCase()}`, signal), base.toUpperCase()); }
  catch (e) { return { ok: false, error: 'network', detail: e instanceof Error ? e.message : String(e) }; }
}
