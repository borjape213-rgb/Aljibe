import { useRef, useState } from 'react';
import { applyQuotes, setSecurityQuoteInfo, ValidationError } from '../actions.ts';
import { useData } from '../store.ts';
import { fetchQuotes, fetchRate, previewQuotes, type PreviewRow, type QuoteResult } from '../logic/quotes.ts';
import { Banner, Button, Field, Sheet, toast } from '../ui.tsx';

/** La clave solo vive en esta variable: se pierde al cerrar o recargar la app y nunca se guarda ni se copia. */
let sessionKey = '';

const ERR: Record<string, string> = {
  'no-symbol': 'Sin símbolo', 'rate-limit': 'Límite del proveedor', provider: 'Rechazado', 'not-found': 'No encontrado', network: 'Sin conexión', fx: 'Sin tipo de cambio', 'bad-data': 'Respuesta no válida',
};
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
export const fmtStamp = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const price = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function PriceUpdate({ onClose }: { onClose: () => void }) {
  const s = useData();
  const [key, setKey] = useState(sessionKey);
  const [phase, setPhase] = useState<'idle' | 'running' | 'preview'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<QuoteResult[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const held = new Set(s.holdings.map((h) => h.securityId));
  const items = s.securities.filter((x) => held.has(x.id));
  const withSymbol = items.filter((x) => (x.symbol ?? '').trim());
  const base = (s.settings.currency || 'EUR').toUpperCase();
  const name = (id: string) => s.securities.find((x) => x.id === id)?.name ?? id;

  const run = async () => {
    setErr(null);
    if (!key.trim()) return setErr('Pega tu clave de Alpha Vantage.');
    if (!withSymbol.length) return setErr('Ningún valor tiene símbolo. Añádelo en la ficha de cada valor.');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setErr('Sin conexión a internet. Inténtalo cuando la tengas.');
    sessionKey = key.trim();
    ctl.current = new AbortController();
    setPhase('running'); setProgress({ done: 0, total: withSymbol.length });
    const res = await fetchQuotes({ apiKey: sessionKey, base, items: withSymbol.map((x) => ({ id: x.id, symbol: x.symbol!, currency: x.currency ?? base })), signal: ctl.current.signal, onProgress: (done, total) => setProgress({ done, total }) });
    if (ctl.current.signal.aborted) { setPhase('idle'); return; }
    const pv = previewQuotes(s.prices, res);
    setResults(res); setRows(pv); setPick(new Set(pv.filter((r) => !r.suspicious && !r.stale).map((r) => r.id)));
    setPhase('preview');
  };
  const apply = async () => {
    try {
      const n = await applyQuotes(rows.filter((r) => pick.has(r.id)).map((r) => ({ id: r.id, date: r.date, price: r.newPrice, rate: r.rate })));
      toast(n ? `Precios actualizados: ${n}` : 'No se ha guardado ningún precio'); onClose();
    } catch (x) { setErr(x instanceof ValidationError ? x.message : 'No se han podido guardar los precios.'); }
  };
  const failed = results.filter((r) => !r.ok);
  const secs = Math.ceil(Math.max(0, withSymbol.length - 1) * 12.5);

  return (
    <Sheet title="Actualizar precios" onClose={() => { ctl.current?.abort(); onClose(); }}>
      {phase === 'idle' ? (
        <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <p className="sm muted" style={{ margin: 0 }}>Consulta el último cierre en Alpha Vantage y el cambio del BCE para valores en otra moneda. Solo se envían símbolos, nunca tus cantidades.</p>
          <Field id="pk" label="Clave de Alpha Vantage (gratuita)" error={err ?? undefined} hint="Solo se guarda en memoria mientras la app está abierta. No entra en la base de datos ni en las copias de seguridad.">
            {(p) => <input {...p} className="input" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />}
          </Field>
          <p className="sm" style={{ margin: 0 }}>{withSymbol.length} de {items.length} valores con símbolo{withSymbol.length ? `. Tardará unos ${secs < 60 ? `${secs} s` : `${Math.ceil(secs / 60)} min`} por el límite del plan gratuito.` : '.'}</p>
          {items.length > withSymbol.length ? <Banner tone="info">Sin símbolo: {items.filter((x) => !(x.symbol ?? '').trim()).map((x) => x.name).join(', ')}.</Banner> : null}
          {withSymbol.length > 25 ? <Banner tone="warn">El plan gratuito permite unas 25 consultas al día: los últimos valores quedarán sin actualizar.</Banner> : null}
          <div className="btnrow"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Actualizar</Button></div>
        </form>
      ) : null}
      {phase === 'running' ? (
        <div className="form">
          <p role="status" style={{ margin: 0 }}>Consultando precios… {Math.min(progress.done + 1, progress.total)} de {progress.total}</p>
          <div className="btnrow"><Button variant="secondary" onClick={() => ctl.current?.abort()}>Cancelar</Button></div>
        </div>
      ) : null}
      {phase === 'preview' ? (
        <div className="form">
          {rows.length === 0 ? <Banner tone="warn">No se ha podido obtener ningún precio.</Banner> : (
            <div role="group" aria-label="Precios obtenidos">
              {rows.map((r) => (
                <label key={r.id} className="row" style={{ minHeight: 56, gap: 12 }}>
                  <input type="checkbox" checked={pick.has(r.id)} onChange={(e) => setPick((p) => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                  <span className="grow"><span className="title">{name(r.id)}</span>
                    <span className="xs muted">{r.oldPrice !== null ? `${price(r.oldPrice)} → ` : ''}{price(r.newPrice)} {base} · cierre del {fmtDay(r.date)}{r.changePct !== null ? ` · ${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(1).replace('.', ',')} %` : ''}</span>
                    {r.suspicious ? <span className="xs neg">Salto de más del 30 %: revísalo antes de aplicarlo.</span> : null}
                    {r.stale ? <span className="xs neg">Más antiguo que tu último precio.</span> : null}
                  </span>
                </label>
              ))}
            </div>
          )}
          {failed.length ? <Banner tone="warn">No se han podido actualizar: {failed.map((r) => `${name(r.id)} (${ERR[r.error ?? 'provider']}${r.detail ? `: ${r.detail}` : ''})`).join('; ')}</Banner> : null}
          {err ? <Banner tone="warn">{err}</Banner> : null}
          <div className="btnrow"><Button variant="secondary" onClick={onClose}>Descartar</Button><Button disabled={!pick.size} onClick={() => void apply()}>Aplicar {pick.size}</Button></div>
        </div>
      ) : null}
    </Sheet>
  );
}

/** Campo de cambio (moneda base por 1 de la moneda del valor) con botón para traer el de hoy del BCE. */
export function FxField({ id, label, cur, base, value, onChange, error, hint, fetchable = true }: { id: string; label: string; cur: string; base: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: string; fetchable?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const get = async () => {
    setBusy(true); setMsg(null);
    const r = await fetchRate(cur, base);
    setBusy(false);
    if (r.ok) onChange(String(Math.round(r.value * 1e6) / 1e6).replace('.', ','));
    else setMsg('No se ha podido obtener el cambio. Escríbelo a mano.');
  };
  return (
    <div>
      <Field id={id} label={label} error={error ?? msg} hint={hint}>{(p) => <input {...p} className="input num" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />}</Field>
      {fetchable ? <Button variant="secondary" disabled={busy} onClick={() => void get()}>{busy ? 'Consultando…' : `Obtener el cambio de hoy (${cur}→${base})`}</Button> : null}
    </div>
  );
}

export function SymbolSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useData();
  const sec = s.securities.find((x) => x.id === id);
  const [symbol, setSymbol] = useState(sec?.symbol ?? '');
  const [cur, setCur] = useState(sec?.currency ?? (s.settings.currency || 'EUR'));
  const [err, setErr] = useState<string | null>(null);
  const base = (s.settings.currency || 'EUR').toUpperCase();
  const [fx, setFx] = useState(sec?.fxRate ? String(sec.fxRate).replace('.', ',') : '');
  const [convert, setConvert] = useState(false);
  if (!sec) return null;
  const c = cur.trim().toUpperCase(), foreign = /^[A-Z]{3}$/.test(c) && c !== base;
  const fxn = Number(fx.replace(',', '.'));
  const firstTime = foreign && !sec.fxRate && (s.prices[id]?.length ?? 0) > 0;
  return (
    <Sheet title="Símbolo y moneda" onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => { e.preventDefault(); try { await setSecurityQuoteInfo(id, symbol, c, foreign && fx.trim() ? fxn : undefined, firstTime && convert); toast('Guardado'); onClose(); } catch (x) { setErr(x instanceof ValidationError ? x.message : 'No se ha podido guardar.'); } }}>
        <Field id="qs" label="Símbolo para precios online" hint="Por ejemplo AIR:EPA (Airbus en París) o AAPL. Vacío = no se actualiza por internet.">{(p) => <input {...p} className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={20} autoCapitalize="characters" />}</Field>
        <Field id="qc" label="Moneda en la que cotiza" error={err ?? undefined} hint="Si no es la de tus cuentas, los precios que escribes están en esa moneda y la app los convierte con el cambio.">{(p) => <input {...p} className="input" value={cur} onChange={(e) => setCur(e.target.value)} maxLength={3} autoCapitalize="characters" />}</Field>
        {foreign ? <FxField id="qf" label={`Cambio actual (${base} por 1 ${c})`} cur={c} base={base} value={fx} onChange={setFx} hint="Se actualiza solo cuando actualizas los precios por internet." /> : null}
        {firstTime ? <label style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 48 }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={convert} onChange={(e) => setConvert(e.target.checked)} />Los precios que ya tengo guardados están en {c}: convertirlos a {base}</label> : null}
        <div className="btnrow"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Sheet>
  );
}
