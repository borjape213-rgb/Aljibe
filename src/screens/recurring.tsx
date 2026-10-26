import { useMemo, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuCheck, LuRepeat } from 'react-icons/lu';
import { useData } from '../store.ts';
import { occurrencesInMonth, detectRecurring } from '../logic/recurring.ts';
import { addMonths, daysInMonth, formatDay, formatMonth, iso, monthStart, parse, todayISO, weekdayMon0 } from '../logic/dates.ts';
import { Amount, Banner, Button, EmptyState, IconButton, Segmented, toast } from '../ui.tsx';
import { TopBar } from './shell.tsx';
import { approveDetected, setRecurringStatus } from '../actions.ts';

const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export function Recurring() {
  const s = useData();
  const today = todayISO();
  const [month, setMonth] = useState(monthStart(today));
  const [day, setDay] = useState<string | null>(null);
  const [view, setView] = useState<'upcoming' | 'done'>('upcoming');
  const occ = useMemo(() => occurrencesInMonth(s, month), [s, month]);
  const detected = useMemo(() => detectRecurring(s), [s]);
  const pending = [...s.recurring.filter((r) => r.status === 'pending-approval'), ...detected];
  const { y, m } = parse(month);
  const lead = weekdayMon0(month);
  const dim = daysInMonth(month);
  const byDay = new Map<string, typeof occ>();
  occ.forEach((o) => byDay.set(o.date, [...(byDay.get(o.date) ?? []), o]));
  const list = (day ? occ.filter((o) => o.date === day) : occ).filter((o) => (view === 'done' ? o.state === 'paid' : o.state !== 'paid'));
  const totalPlan = occ.reduce((n, o) => n + o.stream.amountCents, 0);
  return (
    <>
      <TopBar title="Recurrentes" />
      <main>
        {pending.length ? (
          <section className="card" aria-label="Posibles recurrentes">
            <div className="cardhead"><h2>Detectados: revisa {pending.length}</h2></div>
            {pending.map((r) => (
              <div key={r.id} className="row" style={{ flexWrap: 'wrap' }}>
                <span className="grow" style={{ minWidth: 140 }}><span className="title">{r.name}</span><span className="xs muted">Cada mes, día {r.dayOfMonth}</span></span>
                <Amount cents={r.amountCents} signed />
                <span style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <Button variant="secondary" style={{ minHeight: 44, flex: 1 }} onClick={async () => { if (s.recurring.some((x) => x.id === r.id)) await setRecurringStatus(r.id, 'active'); else await approveDetected(r); toast(`${r.name} añadido`); }}>Aprobar</Button>
                  {s.recurring.some((x) => x.id === r.id) ? <Button variant="ghost" style={{ minHeight: 44, flex: 1 }} onClick={() => setRecurringStatus(r.id, 'cancelled')}>Descartar</Button> : null}
                </span>
              </div>
            ))}
          </section>
        ) : null}
        <section className="card" aria-label="Calendario">
          <div className="cardhead">
            <IconButton label="Mes anterior" onClick={() => { setMonth(addMonths(month, -1)); setDay(null); }}><LuChevronLeft /></IconButton>
            <h2 aria-live="polite">{formatMonth(month)}</h2>
            <IconButton label="Mes siguiente" onClick={() => { setMonth(addMonths(month, 1)); setDay(null); }}><LuChevronRight /></IconButton>
          </div>
          <div className="calendar" role="grid" aria-label={formatMonth(month)}>
            {DOW.map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
            {Array.from({ length: lead }, (_, i) => <span key={'l' + i} />)}
            {Array.from({ length: dim }, (_, i) => {
              const date = iso(y, m, i + 1);
              const os = byDay.get(date) ?? [];
              const inc = os.filter((o) => o.stream.amountCents > 0).length, exp = os.filter((o) => o.stream.amountCents < 0).length;
              const label = `${formatDay(date)}${os.length ? `: ${inc ? inc + ' ingresos' : ''}${inc && exp ? ' y ' : ''}${exp ? exp + ' pagos' : ''}` : ''}`;
              return (
                <button key={date} role="gridcell" className={date === today ? 'today' : ''} aria-pressed={day === date} aria-label={label} aria-current={date === today ? 'date' : undefined} onClick={() => setDay(day === date ? null : date)}>
                  <span>{i + 1}</span>
                  <span className="marks" aria-hidden="true">
                    {inc ? <span className="m inc">{inc > 1 ? inc : '+'}</span> : null}
                    {exp ? <span className="m exp">{exp > 1 ? exp : '−'}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="xs muted" style={{ padding: '0 16px 12px', margin: 0 }}>● verde con + = ingreso, ■ rojo con − = pago. Si hay varios, se muestra el número.</p>
        </section>
        <Segmented label="Ver" value={view} onChange={setView} options={[{ id: 'upcoming', label: 'Pendientes' }, { id: 'done', label: 'Pagados' }]} />
        <section className="card" aria-label={view === 'done' ? 'Pagados' : 'Pendientes'}>
          <div className="sechead"><span>{day ? formatDay(day) : formatMonth(month)}</span><Amount cents={list.reduce((n, o) => n + o.stream.amountCents, 0)} signed tone="none" /></div>
          {list.length === 0 ? <EmptyState icon={<LuRepeat size={28} aria-hidden="true" />} title={s.recurring.length ? 'Nada en esta lista' : 'Sin recurrentes'} text={s.recurring.length ? undefined : 'Cuando tengas pagos que se repiten, los verás aquí.'} /> : list.map((o) => (
            <div key={o.stream.id + o.date} className="row">
              <span className="grow"><span className="title">{o.stream.name}</span><span className="xs muted">{formatDay(o.date, 'es-ES', { day: 'numeric', month: 'short' })} · {o.state === 'paid' ? 'Pagado' : o.state === 'overdue' ? 'Sin cobrar todavía' : 'Próximo'}</span></span>
              {o.state === 'paid' ? <LuCheck aria-label="Pagado" className="pos" /> : null}
              <Amount cents={o.stream.amountCents} signed />
            </div>
          ))}
        </section>
        <Banner tone="info">Previsto del mes: <b className="num"><Amount cents={totalPlan} signed tone="none" /></b> neto entre ingresos y pagos recurrentes.</Banner>
      </main>
    </>
  );
}
