import { useMemo, useState } from 'react';
import { LuPlus, LuTrash2 } from 'react-icons/lu';
import type { Route } from '../router.tsx';
import { setQuery } from '../router.tsx';
import { useData } from '../store.ts';
import { RANGES, allocation, holdingRows, pctSeries, portfolioPctSeries, portfolioReturn, CLASS_LABEL } from '../logic/invest.ts';
import { addDays, todayISO } from '../logic/dates.ts';
import { priceLookup } from '../logic/ledger.ts';
import { parseCents } from '../logic/money.ts';
import type { AssetClass } from '../logic/types.ts';
import { Amount, Banner, Button, Change, EmptyState, Field, IconButton, Ranges, Segmented, Sheet, money, toast } from '../ui.tsx';
import { AreaChart, CHART_COLORS, StackedBar } from '../charts.tsx';
import { TopBar } from './shell.tsx';
import { addPrice, removeHolding, saveHolding, saveSecurity, ValidationError } from '../actions.ts';

const num = (x: string) => { const n = Number(x.replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export function Investments({ route }: { route: Route }) {
  const s = useData();
  const view = (route.query.get('view') as 'holdings' | 'allocation') || 'holdings';
  const rid = route.query.get('range') || '3m';
  const days = RANGES.find((r) => r.id === rid)?.days ?? 91;
  const bench = route.query.get('bench') || '';
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => holdingRows(s, null, days), [s, days]);
  const pr = useMemo(() => portfolioReturn(s, null, days), [s, days]);
  const series = useMemo(() => portfolioPctSeries(s, null, days), [s, days]);
  const bs = s.benchmarks.find((b) => b.id === bench);
  const bser = useMemo(() => (bs ? pctSeries(bs.series, days) : []), [bs, days]);
  const al = useMemo(() => allocation(rows), [rows]);
  const invAccounts = s.accounts.filter((a) => a.group === 'investments');
  return (
    <>
      <TopBar title="Inversiones" end={<IconButton label="Añadir posición" onClick={() => setAdding(true)}><LuPlus /></IconButton>} />
      <main>
        {rows.length === 0 ? <EmptyState title="Sin posiciones" text={invAccounts.length ? 'Añade una posición con su cantidad y precio.' : 'Primero crea una cuenta de inversión en Cuentas.'} action={invAccounts.length ? <Button onClick={() => setAdding(true)}>Añadir posición</Button> : <a className="btn" href="#/accounts">Ir a cuentas</a>} /> : (
          <>
            <Segmented label="Vista" value={view} onChange={(v) => setQuery('view', v === 'holdings' ? null : v)} options={[{ id: 'holdings', label: 'Posiciones' }, { id: 'allocation', label: 'Reparto' }]} />
            <section className="card pad" aria-label="Rendimiento">
              <div className="xl b6"><Amount cents={pr.valueCents} tone="none" /></div>
              <Change pct={pr.pct} cents={pr.deltaCents} label={rid === '1y' ? '1 año' : rid.replace('m', ' meses').replace('1 meses', '1 mes')} />
              <AreaChart points={series.map((p) => ({ date: p.date, value: p.pct }))} format={(v) => `${v.toFixed(1).replace('.', ',')} %`} label="Rentabilidad de la cartera" baseline />
              <Ranges value={rid as '1m'} onChange={(v) => setQuery('range', v === '3m' ? null : v)} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
              <p className="xs muted" style={{ margin: '8px 0 0' }}>Cambio de precio de las posiciones actuales. No incluye aportaciones ni dividendos.</p>
            </section>
            {view === 'holdings' ? (
              <>
                <div className="chips" role="radiogroup" aria-label="Comparar con">
                  <button className="chip" role="radio" aria-checked={!bench} aria-pressed={!bench} onClick={() => setQuery('bench', null)}>Sin comparar</button>
                  {s.benchmarks.map((b) => <button key={b.id} className="chip" role="radio" aria-checked={bench === b.id} aria-pressed={bench === b.id} onClick={() => setQuery('bench', b.id)}>{b.name}</button>)}
                </div>
                {bs ? <Banner tone="info">{bs.name}: <b className="num">{(bser.at(-1)?.pct ?? 0).toFixed(1).replace('.', ',')} %</b> en el periodo. Tu cartera: <b className="num">{pr.pct.toFixed(1).replace('.', ',')} %</b>. {pr.pct >= (bser.at(-1)?.pct ?? 0) ? 'Vas por encima.' : 'Vas por debajo.'}</Banner> : null}
                <section className="card" aria-label="Posiciones">
                  {rows.map((r) => (
                    <a key={r.holding.id} className="row" href={`#/holding/${r.holding.securityId}`}>
                      <span className="grow"><span className="title">{r.name}</span><span className="xs muted">{r.ticker} · {r.holding.quantity.toLocaleString('es-ES')} uds · {s.accounts.find((a) => a.id === r.holding.accountId)?.name}</span></span>
                      <span className="end"><Amount cents={r.valueCents} tone="none" /><br /><Change pct={r.periodPct} pill /></span>
                    </a>
                  ))}
                </section>
              </>
            ) : (
              <section className="card" aria-label="Reparto por tipo de activo">
                <div style={{ padding: 16 }}><StackedBar total={al.total} parts={al.parts.map((p, i) => ({ label: p.label, cents: p.cents, color: CHART_COLORS[i % 8] }))} /></div>
                {al.parts.map((p, i) => (
                  <div key={p.cls} className="row" style={{ minHeight: 52 }}>
                    <span className="dot" style={{ background: CHART_COLORS[i % 8] }} aria-hidden="true" />
                    <span className="grow">{p.label}</span>
                    <span className="num muted sm">{p.pct.toFixed(1).replace('.', ',')} %</span>
                    <span className="end" style={{ minWidth: 90 }}><Amount cents={p.cents} tone="none" /></span>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </main>
      {adding ? <HoldingForm onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function HoldingForm({ onClose, securityId }: { onClose: () => void; securityId?: string }) {
  const s = useData();
  const accounts = s.accounts.filter((a) => a.group === 'investments');
  const [account, setAccount] = useState(accounts[0]?.id ?? '');
  const [sec, setSec] = useState(securityId ?? s.securities[0]?.id ?? '__new');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [name, setName] = useState(''); const [ticker, setTicker] = useState(''); const [cls, setCls] = useState<AssetClass>('equity'); const [price, setPrice] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  if (!accounts.length) return <Sheet title="Añadir posición" onClose={onClose}><Banner tone="warn">Crea primero una cuenta de tipo Inversiones.</Banner></Sheet>;
  const submit = async () => {
    const e: Record<string, string> = {};
    const q = num(qty);
    if (!(q > 0)) e.qty = 'Escribe una cantidad mayor que cero.';
    const c = cost.trim() === '' ? null : parseCents(cost);
    if (cost.trim() !== '' && (c === null || c < 0)) e.cost = 'Escribe un coste válido o déjalo vacío.';
    if (sec === '__new') { if (!name.trim() || !ticker.trim()) e.name = 'Escribe nombre y símbolo.'; if (!(num(price) > 0)) e.price = 'Escribe el precio actual.'; }
    setErr(e);
    if (Object.keys(e).length) return;
    try {
      const id = sec === '__new' ? await saveSecurity({ name, ticker, assetClass: cls, price: num(price), date: todayISO() }) : sec;
      await saveHolding({ accountId: account, securityId: id, quantity: q, costBasisCents: c });
      toast('Posición guardada'); onClose();
    } catch (x) { setErr({ name: x instanceof ValidationError ? x.message : 'No se ha podido guardar.' }); }
  };
  return (
    <Sheet title="Añadir posición" onClose={onClose}>
      <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field id="ha" label="Cuenta">{(p) => <select {...p} className="input" value={account} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}</Field>
        <Field id="hs" label="Valor">{(p) => <select {...p} className="input" value={sec} onChange={(e) => setSec(e.target.value)}>{s.securities.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.ticker})</option>)}<option value="__new">Otro valor nuevo…</option></select>}</Field>
        {sec === '__new' ? <>
          <Field id="hn" label="Nombre" error={err.name}>{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field id="ht" label="Símbolo">{(p) => <input {...p} className="input" value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={12} />}</Field>
          <Field id="hc" label="Tipo de activo">{(p) => <select {...p} className="input" value={cls} onChange={(e) => setCls(e.target.value as AssetClass)}>{(Object.keys(CLASS_LABEL) as AssetClass[]).map((k) => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}</select>}</Field>
          <Field id="hp" label="Precio actual" error={err.price}>{(p) => <input {...p} className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
        </> : null}
        <Field id="hq" label="Cantidad" error={err.qty}>{(p) => <input {...p} className="input num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
        <Field id="hk" label="Coste total (opcional)" error={err.cost} hint="Sirve para ver ganancia o pérdida.">{(p) => <input {...p} className="input num" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        <div className="btnrow"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Sheet>
  );
}

export function HoldingDetail({ id }: { id: string }) {
  const s = useData();
  const sec = s.securities.find((x) => x.id === id);
  const [rid, setRid] = useState('1y');
  const [adding, setAdding] = useState(false);
  const [priceFor, setPriceFor] = useState(false);
  const [pv, setPv] = useState('');
  const [pe, setPe] = useState<string | null>(null);
  const days = RANGES.find((r) => r.id === rid)?.days ?? 365;
  const today = todayISO();
  const f = useMemo(() => priceLookup(s.prices[id]), [s.prices, id]);
  if (!sec) return <><TopBar title="Valor" back="/investments" /><main><Banner tone="warn">No encontramos este valor. <a href="#/investments">Volver</a></Banner></main></>;
  const pts = []; for (let d = addDays(today, -days); d <= today; d = addDays(d, 1)) pts.push({ date: d, value: Math.round(f(d) * 100) });
  const hs = s.holdings.filter((h) => h.securityId === id);
  const rows = holdingRows(s, null, days).filter((r) => r.holding.securityId === id);
  const total = rows.reduce((n, r) => n + r.valueCents, 0);
  const ch = pts.length > 1 && pts[0].value ? { pct: (pts.at(-1)!.value / pts[0].value - 1) * 100, delta: pts.at(-1)!.value - pts[0].value } : { pct: 0, delta: 0 };
  return (
    <>
      <TopBar title={sec.name} back="/investments" />
      <main>
        <section aria-label="Precio">
          <div className="xl b6 num">{(f(today)).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })}</div>
          <Change pct={ch.pct} label={rid} />
          <AreaChart points={pts} label={`Precio de ${sec.name}`} format={(v) => (v / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })} />
          <Ranges value={rid as '1m'} onChange={setRid} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
          <p className="xs muted" style={{ textAlign: 'center' }}>{sec.ticker} · {CLASS_LABEL[sec.assetClass]} · precios de ejemplo/manuales</p>
        </section>
        <section className="card" aria-label="Tus posiciones">
          <div className="sechead"><span>Tus posiciones</span><Amount cents={total} tone="none" /></div>
          {rows.length === 0 ? <p className="sm muted" style={{ padding: 16, margin: 0 }}>No tienes posiciones de este valor.</p> : rows.map((r) => (
            <div key={r.holding.id} className="row">
              <span className="grow"><span className="title">{s.accounts.find((a) => a.id === r.holding.accountId)?.name}</span><span className="xs muted">{r.holding.quantity.toLocaleString('es-ES')} uds{r.gainCents !== null ? ` · ${r.gainCents >= 0 ? 'ganancia' : 'pérdida'} ${money(Math.abs(r.gainCents))}` : ' · sin coste base'}</span></span>
              <Amount cents={r.valueCents} tone="none" />
              <IconButton label={`Quitar posición en ${s.accounts.find((a) => a.id === r.holding.accountId)?.name}`} onClick={async () => { await removeHolding(r.holding.id); toast('Posición quitada'); }}><LuTrash2 /></IconButton>
            </div>
          ))}
        </section>
        <div className="btnrow"><Button variant="secondary" onClick={() => setAdding(true)}>Añadir posición</Button><Button variant="secondary" onClick={() => setPriceFor(true)}>Actualizar precio</Button></div>
        {hs.length === 0 ? null : null}
      </main>
      {adding ? <HoldingForm securityId={id} onClose={() => setAdding(false)} /> : null}
      {priceFor ? (
        <Sheet title="Precio de hoy" onClose={() => setPriceFor(false)}>
          <form className="form" noValidate onSubmit={async (e) => { e.preventDefault(); const n = num(pv); if (!(n > 0)) return setPe('Escribe un precio mayor que cero.'); await addPrice(id, today, n); toast('Precio actualizado'); setPriceFor(false); }}>
            <Field id="pp" label="Precio por unidad" error={pe}>{(p) => <input {...p} className="input num" inputMode="decimal" value={pv} onChange={(e) => setPv(e.target.value)} autoFocus />}</Field>
            <div className="btnrow"><Button variant="secondary" onClick={() => setPriceFor(false)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}
