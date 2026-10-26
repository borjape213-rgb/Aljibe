import { useMemo } from 'react';
import type { Route } from '../router.tsx';
import { setQuery } from '../router.tsx';
import { useData } from '../store.ts';
import { cashFlow } from '../logic/ledger.ts';
import { addMonths, daysInMonth, formatMonth, monthStart, todayISO } from '../logic/dates.ts';
import { Amount, EmptyState, Segmented, money } from '../ui.tsx';
import { FlowChart, type FlowMonth } from '../charts.tsx';
import { TopBar } from './shell.tsx';

const end = (m: string) => `${m.slice(0, 7)}-${String(daysInMonth(m)).padStart(2, '0')}`;
export function CashFlow({ route }: { route: Route }) {
  const s = useData();
  const thisMonth = monthStart(todayISO());
  const month = route.query.get('m') || thisMonth;
  const by = (route.query.get('by') as 'category' | 'group' | 'merchant') || 'category';
  const data: FlowMonth[] = useMemo(() => Array.from({ length: 9 }, (_, i) => addMonths(thisMonth, i - 8)).map((m) => { const c = cashFlow(s, m, end(m), 'group'); return { month: m, label: formatMonth(m).slice(0, 3), income: c.totalIn, expenses: c.totalOut }; }), [s, thisMonth]);
  const cf = useMemo(() => cashFlow(s, month, end(month), by), [s, month, by]);
  const saving = cf.net;
  const empty = s.transactions.length === 0;
  return (
    <>
      <TopBar title="Flujo de caja" />
      <main>
        {empty ? <EmptyState title="Sin movimientos" text="Cuando añadas o importes transacciones verás aquí tus ingresos y gastos." /> : (
          <>
            <section className="card pad" aria-label="Últimos meses">
              <FlowChart data={data} selected={month} onSelect={(m) => setQuery('m', m === thisMonth ? null : m)} />
              <p className="xs muted" style={{ margin: '4px 0 0' }}>Verde arriba: ingresos. Rojo abajo: gastos. La línea negra es el ahorro neto de cada mes.</p>
            </section>
            <section className="card" aria-label={`Resumen de ${formatMonth(month)}`}>
              <div className="sechead"><span>{formatMonth(month)}</span></div>
              <div className="row"><span className="dot" style={{ background: 'var(--color-success)' }} aria-hidden="true" /><span className="grow">Ingresos</span><Amount cents={cf.totalIn} tone="none" className="pos" /></div>
              <div className="row"><span className="dot" style={{ background: 'var(--color-danger)', borderRadius: 2 }} aria-hidden="true" /><span className="grow">Gastos</span><Amount cents={Math.abs(cf.totalOut)} tone="none" className="neg" /></div>
              <div className="row"><span className="dot" style={{ border: '2px solid var(--color-text)' }} aria-hidden="true" /><span className="grow">Ahorro</span><b><Amount cents={saving} tone="none" signed /></b></div>
            </section>
            <Segmented label="Agrupar por" value={by} onChange={(v) => setQuery('by', v === 'category' ? null : v)} options={[{ id: 'category', label: 'Categoría' }, { id: 'group', label: 'Grupo' }, { id: 'merchant', label: 'Comerciante' }]} />
            {[{ title: 'Ingresos', rows: cf.income, total: cf.totalIn }, { title: 'Gastos', rows: cf.expenses, total: cf.totalOut }].map((sec) => (
              <section key={sec.title} className="card" aria-label={sec.title}>
                <div className="sechead"><span>{sec.title}</span><Amount cents={Math.abs(sec.total)} tone="none" /></div>
                {sec.rows.length === 0 ? <p className="muted sm" style={{ padding: 16, margin: 0 }}>Nada este mes.</p> : sec.rows.slice(0, by === 'merchant' ? 15 : 30).map((r) => (
                  <div key={r.key} className="row" style={{ minHeight: 52 }}>
                    <span className="grow"><span className="title">{r.label}</span></span>
                    <span className="muted xs num">{sec.total ? ((r.cents / sec.total) * 100).toFixed(1).replace('.', ',') : '0'} %</span>
                    <span className="end" style={{ minWidth: 90 }}><Amount cents={Math.abs(r.cents)} tone="none" /></span>
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </main>
    </>
  );
}
void money;
