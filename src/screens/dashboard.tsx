import { Fragment, useMemo, type ReactNode } from 'react';
import { LuListChecks, LuChevronRight, LuCalendarCheck } from 'react-icons/lu';
import { widgetOrder } from '../nav.ts';
import { daysBetween } from '../logic/dates.ts';
import { needsCategory } from '../logic/review.ts';
import { resetSeed } from '../actions.ts';
import { Button } from '../ui.tsx';
import { useData } from '../store.ts';
import { accountValueCents, changeOver, netWorthSeries } from '../logic/ledger.ts';
import { budgetSummary } from '../logic/budget.ts';
import { occurrencesInMonth } from '../logic/recurring.ts';
import { holdingRows } from '../logic/invest.ts';
import { addDays, addMonths, formatShort, monthStart, todayISO, formatMonth } from '../logic/dates.ts';
import { Amount, Banner, Change, EmptyState, ProgressBar, money } from '../ui.tsx';
import { AreaChart } from '../charts.tsx';
import { TopBar } from './shell.tsx';
import { TxRow } from './common.tsx';

export function Dashboard() {
  const s = useData();
  const today = todayISO();
  const month = monthStart(today);
  
  const series = useMemo(() => netWorthSeries(s, addDays(today, -30), today), [s, today]);
  const nw = changeOver(series);
  const bs = useMemo(() => budgetSummary(s, month), [s, month]);
  const review = s.transactions.filter(needsCategory);
  const occ = occurrencesInMonth(s, month).filter((o) => o.state !== 'paid').slice(0, 3);
  const inv = useMemo(() => {
    const m = new Map<string, ReturnType<typeof holdingRows>[number]>();
    for (const r of holdingRows(s, null, 30)) { const k = r.holding.securityId; const c = m.get(k); m.set(k, c ? { ...c, valueCents: c.valueCents + r.valueCents } : r); }
    return [...m.values()].sort((a, b) => Math.abs(b.periodPct) - Math.abs(a.periodPct)).slice(0, 4);
  }, [s]);
  const empty = s.accounts.length === 0;
  const blocks: Record<string, ReactNode> = {
    networth: (
          <section className="card pad" aria-label="Patrimonio neto">
            <h2>Patrimonio neto</h2>
            <div className="lg b6 num"><Amount cents={series.at(-1)?.net ?? 0} tone="none" /></div>
            <Change pct={nw.pct} cents={nw.delta} label="1 mes" />
            <AreaChart points={series.map((p) => ({ date: p.date, value: p.net }))} height={130} label="Patrimonio neto, último mes" />
            <a className="btn ghost" href="#/accounts" style={{ minHeight: 40 }}>Ver cuentas</a>
          </section>
        ),
    budget: (
          <section className="card pad" aria-label="Presupuesto del mes">
            <div className="cardhead" style={{ padding: 0 }}><h2>Presupuesto de {formatMonth(month).split(' ')[0].toLowerCase()}</h2><a href="#/budget" className="sm">Abrir</a></div>
            {bs.totalBudget === 0 ? <p className="muted sm">Aún no has fijado importes. <a href="#/budget">Crear presupuesto</a></p> : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '8px 0 6px' }}>
                  <span className="sm">Gastado <b className="num">{money(bs.totalSpent)}</b></span>
                  <span className="sm muted">de {money(bs.totalBudget)}</span>
                </div>
                <ProgressBar spent={bs.totalSpent} budget={bs.totalBudget} label="Gasto del mes frente al presupuesto" />
                <p className={`sm ${bs.totalBudget - bs.totalSpent < 0 ? 'neg' : ''}`} style={{ margin: '8px 0 0' }}>{bs.totalBudget - bs.totalSpent >= 0 ? `Quedan ${money(bs.totalBudget - bs.totalSpent)}` : `Te has pasado ${money(bs.totalSpent - bs.totalBudget)}`}</p>
              </>
            )}
          </section>
        ),
    recent: (
          <section className="card" aria-label="Transacciones">
            <div className="cardhead"><h2>{review.length ? 'Sin categoría' : 'Recientes'}</h2><a className="sm" href="#/transactions">Ver todas</a></div>
            {(review.length ? review : s.transactions).slice(0, 4).map((t) => <TxRow key={t.id} t={t} s={s} />)}
            {s.transactions.length === 0 ? <EmptyState title="Sin transacciones" text="Añade una desde Movimientos o importa un archivo." /> : null}
          </section>
        ),
    invest: inv.length ? (
          <section className="card" aria-label="Inversiones: mayores movimientos">
            <div className="cardhead"><h2>Mayores movimientos (1 mes)</h2><a className="sm" href="#/investments">Abrir</a></div>
            {inv.map((r) => (
              <a key={r.holding.id} className="row" href={`#/holding/${r.holding.securityId}`}>
                <span className="grow"><span className="title">{r.name}</span><span className="xs muted">{r.ticker}</span></span>
                <span className="end"><Amount cents={r.valueCents} /><br /><Change pct={r.periodPct} pill /></span>
              </a>
            ))}
          </section>
        ) : null,
    recurring: occ.length ? (
          <section className="card" aria-label="Próximos pagos">
            <div className="cardhead"><h2>Próximos pagos</h2><a className="sm" href="#/recurring">Calendario</a></div>
            {occ.map((o) => (
              <a key={o.stream.id + o.date} className="row" href="#/recurring">
                <span className="grow"><span className="title">{o.stream.name}</span><span className="xs muted">{formatShort(o.date)}{o.state === 'overdue' ? ' · sin cobrar todavía' : ''}</span></span>
                <span className="end"><Amount cents={o.stream.amountCents} signed /></span>
                <LuChevronRight aria-hidden="true" size={18} className="muted" />
              </a>
            ))}
          </section>
        ) : null,
    monthreview: (
      <a className="card row" href="#/month-review" style={{ minHeight: 56 }}><LuCalendarCheck aria-hidden="true" /><span className="grow"><span className="title">Revisión de {formatMonth(addMonths(month, -1)).toLowerCase()}</span><span className="xs muted">Un repaso de cinco páginas</span></span><LuChevronRight aria-hidden="true" /></a>
    ),
  };
  const lastBackup = s.settings.lastBackupAt ?? s.settings.createdAt;
  const daysSince = lastBackup ? daysBetween(lastBackup.slice(0, 10), today) : 999;
  const backupDue = daysSince >= 30 && s.accounts.length > 0;
  const backupText = s.settings.lastBackupAt ? `Hace ${daysSince} días que no descargas una copia de seguridad. Tus datos solo están en este móvil.` : 'Aún no has descargado ninguna copia de seguridad. Tus datos solo están en este móvil.';
  return (
    <>
      <TopBar title="Inicio" />
      <main>
        {empty ? <Guide /> : null}
        {!empty && backupDue ? <Banner tone="warn" href="#/settings/data">{backupText}</Banner> : null}
        {review.length ? <Banner tone="info" href="#/review" icon={<LuListChecks aria-hidden="true" />}>Tienes {review.length} movimientos sin categoría.</Banner> : null}
        {!empty ? widgetOrder(s.settings).filter((x) => x.visible).map((x) => <Fragment key={x.id}>{blocks[x.id] ?? null}</Fragment>) : null}
        <p className="xs muted" style={{ textAlign: 'center' }}>{s.seededAt ? 'Son datos de ejemplo. Vacíalos cuando quieras en Ajustes, Datos y copia.' : ''}</p>
      </main>
    </>
  );
}
void accountValueCents;

function Guide() {
  const s = useData();
  const steps = [
    { done: s.accounts.length > 0, text: 'Crea tu primera cuenta', href: '#/accounts', cta: 'Crear cuenta' },
    { done: s.transactions.length > 0, text: 'Importa tus movimientos desde un CSV o un Excel de tu banco, o apúntalos a mano', href: '#/settings/data', cta: 'Importar' },
    { done: s.budgetItems.length > 0, text: 'Fija cuánto quieres gastar cada mes', href: '#/budget', cta: 'Ir a presupuesto' },
  ];
  return (
    <section className="card pad" aria-label="Primeros pasos">
      <h2>Aquí todavía no hay nada</h2>
      <p className="muted sm" style={{ margin: '4px 0 12px' }}>Tres pasos para empezar. Tus datos se quedan en este móvil.</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((st, i) => (
          <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="avatar" aria-hidden="true" style={{ width: 32, height: 32 }}>{st.done ? '✓' : i + 1}</span>
            <span className="grow" style={{ flex: 1 }}>{st.text}{st.done ? <span className="sr"> (hecho)</span> : null}</span>
            <a className="btn secondary" style={{ minHeight: 40, padding: '0 12px' }} href={st.href}>{st.cta}</a>
          </li>
        ))}
      </ol>
      <div style={{ marginTop: 16 }}><Button variant="ghost" onClick={() => resetSeed()}>Probar con datos de ejemplo</Button></div>
    </section>
  );
}
