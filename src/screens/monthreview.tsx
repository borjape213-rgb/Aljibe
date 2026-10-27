import { useEffect, useMemo, useRef, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuCheck } from 'react-icons/lu';
import type { Route } from '../router.tsx';
import { setQuery } from '../router.tsx';
import { useData } from '../store.ts';
import { cashFlow, changeOver, netWorthSeries } from '../logic/ledger.ts';
import { budgetSummary } from '../logic/budget.ts';
import { occurrencesInMonth } from '../logic/recurring.ts';
import { addMonths, daysInMonth, formatMonth, monthStart, todayISO } from '../logic/dates.ts';
import { Amount, Banner, Button, Change, EmptyState, IconButton, ProgressBar, money } from '../ui.tsx';
import { CHART_COLORS, StackedBar } from '../charts.tsx';
import { TopBar } from './shell.tsx';
import { needsCategory } from '../logic/review.ts';

const end = (m: string) => `${m.slice(0, 7)}-${String(daysInMonth(m)).padStart(2, '0')}`;
const doneKey = (m: string) => `aljibe.monthreview.${m}`;
const readDone = (m: string) => { try { return localStorage.getItem(doneKey(m)) === '1'; } catch { return false; } };
const pct = (a: number, b: number) => (b === 0 ? 0 : ((a - b) / Math.abs(b)) * 100);

export function MonthReview({ route }: { route: Route }) {
  const s = useData();
  const thisMonth = monthStart(todayISO());
  const month = route.query.get('m') || addMonths(thisMonth, -1);
  const prev = addMonths(month, -1);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(() => readDone(month));
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { setDone(readDone(month)); setPage(0); scroller.current?.scrollTo({ left: 0 }); }, [month]);

  const cf = useMemo(() => cashFlow(s, month, end(month), 'category'), [s, month]);
  const cfPrev = useMemo(() => cashFlow(s, prev, end(prev), 'category'), [s, prev]);
  const bs = useMemo(() => budgetSummary(s, month), [s, month]);
  const nw = useMemo(() => netWorthSeries(s, addMonths(month, 0) , end(month)), [s, month]);
  const nwChange = changeOver(nw);
  const occ = useMemo(() => occurrencesInMonth(s, month).filter((o) => o.state === 'overdue'), [s, month]);
  const pending = s.transactions.filter((t) => needsCategory(t) && t.date >= month && t.date <= end(month)).length;
  const over = bs.buckets.flatMap((b) => b.groups.flatMap((g) => g.rows)).filter((r) => r.remaining < 0).sort((a, b) => a.remaining - b.remaining);
  const saving = cf.net, savingPrev = cfPrev.net;
  const hasData = s.transactions.some((t) => t.date >= month && t.date <= end(month));
  const N = 5;

  const go = (i: number) => {
    const n = Math.max(0, Math.min(N - 1, i));
    setPage(n);
    const el = scroller.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const onScroll = () => { const el = scroller.current; if (el) setPage(Math.round(el.scrollLeft / el.clientWidth)); };
  const finish = () => { try { localStorage.setItem(doneKey(month), '1'); } catch { /* sin almacenamiento: no se recuerda */ } setDone(true); };
  const top = cf.expenses.slice(0, 6);
  const totalOut = Math.abs(cf.totalOut);

  return (
    <>
      <TopBar title="Revisión mensual" back="/" end={<><IconButton label="Mes anterior" onClick={() => setQuery('m', addMonths(month, -1))}><LuChevronLeft /></IconButton><IconButton label="Mes siguiente" disabled={addMonths(month, 1) > thisMonth} onClick={() => setQuery('m', addMonths(month, 1) === addMonths(thisMonth, -1) ? null : addMonths(month, 1))}><LuChevronRight /></IconButton></>} />
      <main style={{ paddingBottom: 96 }}>
        {!hasData ? <EmptyState title="Ese mes no tiene movimientos" text="Cuando haya movimientos de ese mes, aquí verás el resumen." /> : (
          <>
            {done ? <Banner tone="ok">Este mes ya está revisado. Puedes volver a leerlo cuando quieras.</Banner> : null}
            <div className="mr-track" ref={scroller} onScroll={onScroll} role="group" aria-roledescription="carrusel" aria-label="Páginas de la revisión">
              <section className="mr-page" role="group" aria-roledescription="página" aria-label="Página 1 de 5: resumen" inert={page !== 0}>
                <div className="card pad">
                  <h2>Resumen</h2>
                  <p className="muted sm" style={{ margin: '4px 0 12px' }}>{formatMonth(month)} frente a {formatMonth(prev).toLowerCase()}.</p>
                  {[{ l: 'Ingresos', v: cf.totalIn, p: cfPrev.totalIn, good: 'up' as const }, { l: 'Gastos', v: Math.abs(cf.totalOut), p: Math.abs(cfPrev.totalOut), good: 'down' as const }, { l: 'Ahorro', v: saving, p: savingPrev, good: 'up' as const }].map((r) => (
                    <div key={r.l} className="row" style={{ padding: '8px 0', minHeight: 56 }}>
                      <span className="grow"><b>{r.l}</b></span>
                      <span className="end"><Amount cents={r.v} tone="none" /><br />{cfPrev.totalIn === 0 && cfPrev.totalOut === 0 ? <span className="xs muted">Sin mes anterior</span> : <Change pct={pct(r.v, r.p)} goodWhen={r.good} />}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="mr-page" role="group" aria-roledescription="página" aria-label="Página 2 de 5: en qué se fue" inert={page !== 1}>
                <div className="card pad">
                  <h2>En qué se fue</h2>
                  {top.length === 0 ? <p className="muted sm">Sin gastos este mes.</p> : <>
                    <div style={{ margin: '12px 0' }}><StackedBar total={totalOut} parts={top.map((r, i) => ({ label: r.label, cents: Math.abs(r.cents), color: CHART_COLORS[i % 8] }))} /></div>
                    {top.map((r, i) => (
                      <div key={r.key} className="row" style={{ padding: '6px 0', minHeight: 48 }}>
                        <span className="dot" style={{ background: CHART_COLORS[i % 8] }} aria-hidden="true" />
                        <span className="grow">{r.label}</span>
                        <span className="muted xs num">{totalOut ? Math.round((Math.abs(r.cents) / totalOut) * 100) : 0} %</span>
                        <Amount cents={Math.abs(r.cents)} tone="none" />
                      </div>
                    ))}
                  </>}
                </div>
              </section>
              <section className="mr-page" role="group" aria-roledescription="página" aria-label="Página 3 de 5: presupuesto" inert={page !== 2}>
                <div className="card pad">
                  <h2>Presupuesto</h2>
                  {bs.totalBudget === 0 ? <p className="muted sm">Ese mes no tenía presupuesto.</p> : <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', margin: '8px 0 6px' }}><span className="sm">Gastado <b className="num">{money(bs.totalSpent)}</b></span><span className="sm muted">de {money(bs.totalBudget)}</span></div>
                    <ProgressBar spent={bs.totalSpent} budget={bs.totalBudget} label="Gasto frente al presupuesto" />
                    <h3 className="sm" style={{ margin: '16px 0 4px' }}>{over.length ? `Categorías pasadas: ${over.length}` : 'Ninguna categoría se pasó'}</h3>
                    {over.slice(0, 5).map((r) => <div key={r.categoryId} className="row" style={{ padding: '6px 0', minHeight: 44 }}><span className="grow">{r.name}</span><span className="neg num">▲ {money(-r.remaining)} de más</span></div>)}
                  </>}
                </div>
              </section>
              <section className="mr-page" role="group" aria-roledescription="página" aria-label="Página 4 de 5: patrimonio" inert={page !== 3}>
                <div className="card pad">
                  <h2>Patrimonio</h2>
                  <p className="muted sm" style={{ margin: '4px 0 8px' }}>Cambio durante {formatMonth(month).toLowerCase()}.</p>
                  <div className="xl b6"><Amount cents={nw.at(-1)?.net ?? 0} tone="none" /></div>
                  <Change pct={nwChange.pct} cents={nwChange.delta} />
                  <p className="xs muted" style={{ marginTop: 12 }}>Se calcula con los saldos de hoy hacia atrás, usando tus movimientos y las valoraciones de tus bienes.</p>
                </div>
              </section>
              <section className="mr-page" role="group" aria-roledescription="página" aria-label="Página 5 de 5: pendiente" inert={page !== 4}>
                <div className="card pad form">
                  <h2>Para cerrar el mes</h2>
                  <p className="sm" style={{ margin: 0 }}>{pending ? `Quedan ${pending} movimientos sin categoría de ${formatMonth(month).toLowerCase()}.` : 'Todos los movimientos del mes tienen categoría.'}</p>
                  {pending ? <a className="btn secondary" href="#/review">Categorizar ahora</a> : null}
                  <p className="sm" style={{ margin: 0 }}>{occ.length ? `Hay ${occ.length} pagos recurrentes sin cobrar: ${occ.slice(0, 3).map((o) => o.stream.name).join(', ')}${occ.length > 3 ? '…' : ''}.` : 'Todos los recurrentes del mes están al día.'}</p>
                  <Button onClick={finish} disabled={done}>{done ? <><LuCheck aria-hidden="true" size={18} />Mes revisado</> : 'Marcar el mes como revisado'}</Button>
                </div>
              </section>
            </div>
            <div className="mr-ctrl">
              <Button variant="secondary" onClick={() => go(page - 1)} disabled={page === 0}>Anterior</Button>
              <span className="sm muted" aria-live="polite">{page + 1} de {N}</span>
              <Button variant="secondary" onClick={() => go(page + 1)} disabled={page === N - 1}>Siguiente</Button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
