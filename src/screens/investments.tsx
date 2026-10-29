import { useMemo, useState } from 'react';
import { LuPlus, LuTrash2 } from 'react-icons/lu';
import type { Route } from '../router.tsx';
import { setQuery } from '../router.tsx';
import { useData } from '../store.ts';
import { RANGES, allocation, costOf, currentFx, holdingRows, isForeign, type HoldingRow, pctSeries, portfolioPctSeries, portfolioReturn, CLASS_LABEL } from '../logic/invest.ts';
import { addDays, todayISO } from '../logic/dates.ts';
import { priceLookup } from '../logic/ledger.ts';
import type { AssetClass, Holding } from '../logic/types.ts';
import { Amount, Banner, Button, Change, EmptyState, Field, IconButton, Ranges, Segmented, Sheet, money, toast } from '../ui.tsx';
import { AreaChart, CHART_COLORS, StackedBar } from '../charts.tsx';
import { TopBar } from './shell.tsx';
import { FxField, PriceUpdate, SymbolSheet, fmtStamp } from './priceupdate.tsx';
import { addPrice, removeHolding, saveHolding, saveSecurity, ValidationError } from '../actions.ts';

const unit = (n: number, cur: string) => n.toLocaleString('es-ES', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: 'always' });
const qtyText = (q: number) => q.toLocaleString('es-ES', { maximumFractionDigits: 6 });

/** Cantidad, precio unitario de compra y actual a la izquierda; valor total, ganancia o pérdida y % a la derecha. */
export function PositionInfo({ r, sub }: { r: HoldingRow; sub: string }) {
  const cur = r.currency;
  const g = r.gainCents, up = g !== null && g >= 0;
  const pct = r.gainPct === null ? '' : `${r.gainPct >= 0 ? '+' : '−'}${Math.abs(r.gainPct).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  return (
    <>
      <span className="grow"><span className="title" style={{ display: 'block' }}>{r.name}</span>
        <span className="xs muted" style={{ display: 'block' }}>{sub}</span>
        {r.fxMissing ? <span className="xs neg" style={{ display: 'block' }}>Falta el cambio de moneda: ábrelo en la ficha, «Símbolo y moneda».</span> : null}
        <span className="xs muted num" style={{ display: 'block' }}><span style={{ whiteSpace: 'nowrap' }}>{qtyText(r.holding.quantity)} uds</span> · <span style={{ whiteSpace: 'nowrap' }}>compra {r.unitCost === null ? '—' : unit(r.unitCost, cur)}</span> · <span style={{ whiteSpace: 'nowrap' }}>actual {unit(r.unitPrice, cur)}</span></span>
      </span>
      <span className="end" style={{ textAlign: 'right' }}>
        <b className="num"><Amount cents={r.valueCents} tone="none" /></b><br />
        {g === null ? <span className="xs muted">sin coste</span> : <>
          <span className={`xs num ${up ? 'pos' : 'neg'}`} aria-label={`${up ? 'ganancia' : 'pérdida'} ${money(Math.abs(g))}`}><span aria-hidden="true">{up ? '+' : '−'}{money(Math.abs(g))}</span></span><br />
          <span className={`xs num ${up ? 'pos' : 'neg'}`} aria-hidden="true">({pct})</span>
        </>}
      </span>
    </>
  );
}

const num = (x: string) => { const n = Number(x.replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export function Investments({ route }: { route: Route }) {
  const s = useData();
  const view = (route.query.get('view') as 'holdings' | 'allocation') || 'holdings';
  const rid = route.query.get('range') || '3m';
  const days = RANGES.find((r) => r.id === rid)?.days ?? 91;
  const bench = route.query.get('bench') || '';
  const [adding, setAdding] = useState(false);
  const [updating, setUpdating] = useState(false);
  const lastUpdate = s.securities.reduce((m, x) => (x.updatedAt && x.updatedAt > m ? x.updatedAt : m), '');
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
            <div className="row" style={{ minHeight: 48 }}>
              <span className="grow xs muted">{lastUpdate ? `Precios actualizados el ${fmtStamp(lastUpdate)}` : 'Precios introducidos a mano'}</span>
              <Button variant="secondary" onClick={() => setUpdating(true)}>Actualizar precios</Button>
            </div>
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
                      <PositionInfo r={r} sub={`${r.ticker} · ${s.accounts.find((a) => a.id === r.holding.accountId)?.name ?? ''}`} />
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
      {updating ? <PriceUpdate onClose={() => setUpdating(false)} /> : null}
    </>
  );
}

const plain = (n: number) => String(Math.round(n * 1e6) / 1e6).replace('.', ',');

export function HoldingForm({ onClose, securityId, holding, accountId }: { onClose: () => void; securityId?: string; holding?: Holding; accountId?: string }) {
  const s = useData();
  const editing = !!holding;
  const accounts = s.accounts.filter((a) => a.group === 'investments');
  const [account, setAccount] = useState(holding?.accountId ?? (accountId && accounts.some((x) => x.id === accountId) ? accountId : accounts[0]?.id) ?? '');
  const [sec, setSec] = useState(holding?.securityId ?? securityId ?? s.securities[0]?.id ?? '__new');
  const [qty, setQty] = useState(holding ? plain(holding.quantity) : '');
  const hsec = holding ? s.securities.find((x) => x.id === holding.securityId) : undefined;
  const hfx = hsec ? currentFx(s, hsec) : 1;
  const exact = holding ? costOf(holding, hfx) : null;
  const [unitCost, setUnitCost] = useState(holding ? (typeof holding.unitCost === 'number' ? plain(holding.unitCost) : exact !== null && holding.quantity > 0 ? plain(exact / 100 / holding.quantity / (holding.costFx ?? hfx ?? 1)) : '') : '');
  const [costFx, setCostFx] = useState(holding?.costFx ? plain(holding.costFx) : '');
  const [fxNew, setFxNew] = useState('');
  const [name, setName] = useState(''); const [ticker, setTicker] = useState(''); const [cls, setCls] = useState<AssetClass>('equity'); const [price, setPrice] = useState(''); const [symbol, setSymbol] = useState(''); const [cur, setCur] = useState('EUR');
  const [err, setErr] = useState<Record<string, string>>({});
  const base = (s.settings.currency || 'EUR').toUpperCase();
  const secObj = s.securities.find((x) => x.id === sec);
  const curCode = sec === '__new' ? cur.trim().toUpperCase() : (secObj?.currency ?? base).toUpperCase();
  const foreign = /^[A-Z]{3}$/.test(curCode) && curCode !== base;
  const rate = !foreign ? 1 : sec === '__new' ? (num(fxNew) > 0 ? num(fxNew) : null) : secObj ? currentFx(s, secObj) : null;
  const buyRate = !foreign ? 1 : costFx.trim() !== '' ? num(costFx) : rate;
  const qn = num(qty), un = unitCost.trim() === '' ? NaN : num(unitCost);
  const total = qn > 0 && un >= 0 && buyRate && buyRate > 0 ? Math.round(qn * un * buyRate * 100) : null;
  const lastPrice = secObj ? (s.prices[sec] ?? []).at(-1) : undefined;
  if (!accounts.length) return <Sheet title="Añadir posición" onClose={onClose}><Banner tone="warn">Crea primero una cuenta de tipo Inversiones.</Banner></Sheet>;
  const submit = async () => {
    const e: Record<string, string> = {};
    const q = num(qty);
    if (!(q > 0)) e.qty = 'Escribe una cantidad mayor que cero.';
    const uc = unitCost.trim() === '' ? null : num(unitCost);
    if (uc !== null && !(uc >= 0)) e.cost = 'Escribe un precio de compra válido o déjalo vacío.';
    if (foreign && !rate) e.fx = sec === '__new' ? `Indica el cambio actual (${base} por 1 ${curCode}).` : `Falta el cambio de ${curCode}: indícalo en la ficha del valor, «Símbolo y moneda».`;
    if (foreign && costFx.trim() !== '' && !(num(costFx) > 0)) e.costfx = 'Escribe un cambio válido o déjalo vacío.';
    const c = uc === null || !(q > 0) ? null : Math.round(q * uc * (buyRate ?? 1) * 100);
    if (sec === '__new') { if (!name.trim() || !ticker.trim()) e.name = 'Escribe nombre y símbolo.'; if (!(num(price) > 0)) e.price = 'Escribe el precio actual.'; if (cur.trim() !== '' && !/^[A-Za-z]{3}$/.test(cur.trim())) e.cur = 'La moneda son tres letras (EUR, USD…).'; }
    setErr(e);
    if (Object.keys(e).length) return;
    try {
      const id = sec === '__new' ? await saveSecurity({ name, ticker, assetClass: cls, price: num(price) * (rate ?? 1), date: todayISO(), symbol, currency: curCode || base, fxRate: foreign ? rate ?? undefined : undefined }) : sec;
      await saveHolding({ id: holding?.id, accountId: account, securityId: id, quantity: q, costBasisCents: c, unitCost: uc, costFx: foreign && costFx.trim() !== '' ? num(costFx) : null });
      toast(editing ? 'Posición actualizada' : 'Posición guardada'); onClose();
    } catch (x) { setErr({ name: x instanceof ValidationError ? x.message : 'No se ha podido guardar.' }); }
  };
  return (
    <Sheet title={editing ? 'Editar posición' : 'Añadir posición'} onClose={onClose}>
      <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field id="ha" label="Cuenta">{(p) => <select {...p} className="input" value={account} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}</Field>
        <Field id="hs" label="Valor" hint={sec !== '__new' && lastPrice ? `Precio actual guardado: ${unit(foreign && rate ? lastPrice.price / rate : lastPrice.price, foreign && rate ? curCode : base)} (${lastPrice.date.slice(8, 10)}/${lastPrice.date.slice(5, 7)}/${lastPrice.date.slice(0, 4)}). Se cambia con «Actualizar precio» en la ficha del valor.` : undefined}>{(p) => <select {...p} className="input" value={sec} disabled={editing} onChange={(e) => setSec(e.target.value)}>{s.securities.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.ticker})</option>)}<option value="__new">Otro valor nuevo…</option></select>}</Field>
        {sec === '__new' && !editing ? <>
          <Field id="hn" label="Nombre" error={err.name}>{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field id="ht" label="Símbolo">{(p) => <input {...p} className="input" value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={12} />}</Field>
          <Field id="hy" label="Símbolo para precios online (opcional)" hint="Por ejemplo AIR:EPA o AAPL.">{(p) => <input {...p} className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={20} autoCapitalize="characters" />}</Field>
          <Field id="hm" label="Moneda en la que cotiza" error={err.cur}>{(p) => <input {...p} className="input" value={cur} onChange={(e) => setCur(e.target.value)} maxLength={3} autoCapitalize="characters" />}</Field>
          {foreign ? <FxField id="hf" label={`Cambio actual (${base} por 1 ${curCode})`} cur={curCode} base={base} value={fxNew} onChange={setFxNew} error={err.fx} hint="Para convertir a tu moneda el precio y el coste que escribas en dólares u otra moneda." /> : null}
          <Field id="hc" label="Tipo de activo">{(p) => <select {...p} className="input" value={cls} onChange={(e) => setCls(e.target.value as AssetClass)}>{(Object.keys(CLASS_LABEL) as AssetClass[]).map((k) => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}</select>}</Field>
          <Field id="hp" label={`Precio actual (${curCode || base})`} error={err.price}>{(p) => <input {...p} className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
        </> : null}
        <Field id="hq" label="Cantidad (unidades)" error={err.qty}>{(p) => <input {...p} className="input num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
        {foreign && sec !== '__new' && !rate ? <Banner tone="warn">{err.fx ?? `Falta el cambio de ${curCode}: indícalo en la ficha del valor, «Símbolo y moneda».`}</Banner> : null}
        <Field id="hk" label={`Precio de compra por unidad (${curCode || base}, opcional)`} error={err.cost} hint={total === null ? 'El coste total se calcula solo (cantidad × precio). Sirve para ver ganancia o pérdida.' : foreign ? `Coste total: ${money(total)} (con cambio ${String(Math.round((buyRate ?? 0) * 1e6) / 1e6).replace('.', ',')})` : `Coste total: ${money(total)}`}>{(p) => <input {...p} className="input num" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />}</Field>
        {foreign ? <Field id="hx" label={`Cambio al comprar (${base} por 1 ${curCode}, opcional)`} error={err.costfx} hint="Con el que tu broker convirtió al comprar. Vacío = se usa el cambio actual y la ganancia no incluye el efecto del cambio.">{(p) => <input {...p} className="input num" inputMode="decimal" value={costFx} onChange={(e) => setCostFx(e.target.value)} />}</Field> : null}
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
  const [symFor, setSymFor] = useState(false);
  const [editHolding, setEditHolding] = useState<Holding | null>(null);
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
  const base = (s.settings.currency || 'EUR').toUpperCase();
  const fx = currentFx(s, sec), foreign = isForeign(s, sec), nat = foreign && fx ? (sec.currency ?? base).toUpperCase() : base;
  const ch = pts.length > 1 && pts[0].value ? { pct: (pts.at(-1)!.value / pts[0].value - 1) * 100, delta: pts.at(-1)!.value - pts[0].value } : { pct: 0, delta: 0 };
  return (
    <>
      <TopBar title={sec.name} back="/investments" />
      <main>
        <section aria-label="Precio">
          <div className="xl b6 num">{unit(f(today) / (foreign && fx ? fx : 1), nat)}</div>
          {foreign && fx ? <div className="sm muted num">= {unit(f(today), base)} · cambio {String(fx).replace('.', ',')} {base} por 1 {nat}{sec.fxDate ? ` (${sec.fxDate.slice(8, 10)}/${sec.fxDate.slice(5, 7)})` : ''}</div> : null}
          {foreign && !fx ? <Banner tone="warn">Este valor cotiza en {(sec.currency ?? '').toUpperCase()} y falta el cambio a {base}: indícalo en «Símbolo y moneda».</Banner> : null}
          <Change pct={ch.pct} label={rid} />
          <AreaChart points={pts} label={`Precio de ${sec.name}`} format={(v) => unit(v / 100 / (foreign && fx ? fx : 1), nat)} />
          <Ranges value={rid as '1m'} onChange={setRid} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
          <p className="xs muted" style={{ textAlign: 'center' }}>{sec.ticker} · {CLASS_LABEL[sec.assetClass]} · {sec.updatedAt ? `precio actualizado el ${fmtStamp(sec.updatedAt)}` : 'precio manual'}{sec.symbol ? ` · ${sec.symbol} (${sec.currency ?? 'EUR'})` : ''}</p>
        </section>
        <section className="card" aria-label="Tus posiciones">
          <div className="sechead"><span>Tus posiciones</span><Amount cents={total} tone="none" /></div>
          {rows.length === 0 ? <p className="sm muted" style={{ padding: 16, margin: 0 }}>No tienes posiciones de este valor.</p> : rows.map((r) => (
            <div key={r.holding.id} className="row">
              <PositionInfo r={r} sub={s.accounts.find((a) => a.id === r.holding.accountId)?.name ?? ''} />
              <Button variant="ghost" onClick={() => setEditHolding(r.holding)}>Editar</Button>
              <IconButton label={`Quitar posición en ${s.accounts.find((a) => a.id === r.holding.accountId)?.name}`} onClick={async () => { await removeHolding(r.holding.id); toast('Posición quitada'); }}><LuTrash2 /></IconButton>
            </div>
          ))}
        </section>
        <div className="btnrow"><Button variant="secondary" onClick={() => setAdding(true)}>Añadir posición</Button><Button variant="secondary" onClick={() => setPriceFor(true)}>Actualizar precio</Button><Button variant="secondary" onClick={() => setSymFor(true)}>Símbolo y moneda</Button></div>
        {hs.length === 0 ? null : null}
      </main>
      {adding ? <HoldingForm securityId={id} onClose={() => setAdding(false)} /> : null}
      {editHolding ? <HoldingForm holding={editHolding} onClose={() => setEditHolding(null)} /> : null}
      {symFor ? <SymbolSheet id={id} onClose={() => setSymFor(false)} /> : null}
      {priceFor ? (
        <Sheet title="Precio de hoy" onClose={() => setPriceFor(false)}>
          <form className="form" noValidate onSubmit={async (e) => { e.preventDefault(); const n = num(pv); if (!(n > 0)) return setPe('Escribe un precio mayor que cero.'); if (foreign && !fx) return setPe(`Falta el cambio de ${(sec.currency ?? '').toUpperCase()}: indícalo en «Símbolo y moneda».`); await addPrice(id, today, n * (foreign && fx ? fx : 1)); toast('Precio actualizado'); setPriceFor(false); }}>
            <Field id="pp" label={`Precio por unidad (${nat})`} error={pe}>{(p) => <input {...p} className="input num" inputMode="decimal" value={pv} onChange={(e) => setPv(e.target.value)} autoFocus />}</Field>
            <div className="btnrow"><Button variant="secondary" onClick={() => setPriceFor(false)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}
