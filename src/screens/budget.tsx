import { useMemo, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuChevronDown, LuRepeat } from 'react-icons/lu';
import type { Route } from '../router.tsx';
import { setQuery } from '../router.tsx';
import { useData } from '../store.ts';
import { budgetSummary, type BudgetRow } from '../logic/budget.ts';
import { addMonths, formatMonth, monthStart, todayISO } from '../logic/dates.ts';
import { parseCents } from '../logic/money.ts';
import { Amount, Banner, Button, EmptyState, Field, IconButton, ProgressBar, Sheet, money, toast } from '../ui.tsx';
import { TopBar } from './shell.tsx';
import { copyBudget, setBudget, setRollover, ValidationError } from '../actions.ts';

export function Budget({ route }: { route: Route }) {
  const s = useData();
  const thisMonth = monthStart(todayISO());
  const month = route.query.get('m') || thisMonth;
  const bs = useMemo(() => budgetSummary(s, month), [s, month]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [edit, setEdit] = useState<BudgetRow | null>(null);
  const [showAll, setShowAll] = useState(false);
  const nav = (n: number) => setQuery('m', addMonths(month, n) === thisMonth ? null : addMonths(month, n));
  const state = bs.leftToBudget > 0 ? 'ok' : bs.leftToBudget < 0 ? 'bad' : 'zero';
  const noBudget = bs.totalBudget === 0;
  const hiddenCount = bs.buckets.flatMap((b) => b.groups.flatMap((g) => g.rows)).filter((r) => r.budget === 0 && r.spent === 0 && r.rollover === 0).length;
  return (
    <>
      <TopBar title={formatMonth(month)} end={<><IconButton label="Mes anterior" onClick={() => nav(-1)}><LuChevronLeft /></IconButton><IconButton label="Mes siguiente" onClick={() => nav(1)}><LuChevronRight /></IconButton></>} />
      <main>
        {noBudget ? (
          <EmptyState title="Este mes aún no tiene presupuesto" text="Copia el del mes anterior o fija importes por categoría." action={<Button onClick={async () => { try { const n = await copyBudget(addMonths(month, -1), month); toast(`Copiadas ${n} categorías`); } catch (e) { toast(e instanceof ValidationError ? e.message : 'No se ha podido copiar'); } }}>Copiar mes anterior</Button>} />
        ) : null}
        <div className={`banner-bar ${state}`} role="status">
          <span>{state === 'bad' ? 'Has repartido de más' : 'Te queda por repartir'}</span>
          <Amount cents={Math.abs(bs.leftToBudget)} tone="none" />
        </div>
        <section className="card pad" aria-label="Resumen">
          <Summ label="Ingresos" done={bs.incomeActual} plan={bs.expectedIncome} doneLabel="Ingresado" />
          <div style={{ height: 12 }} />
          <Summ label="Gastos" done={bs.totalSpent} plan={bs.totalBudget} doneLabel="Gastado" expense />
        </section>
        {bs.buckets.map((b) => (
          <section key={b.bucket} aria-label={b.label}>
            <div className="sechead plain"><h2>{b.label}</h2><span className="xs">{money(b.budget)} presupuestado</span></div>
            <div className="colhead" aria-hidden="true"><span /><span>Presupuesto</span><span>Restante</span></div>
            <div className="card">
              {b.groups.map((g) => {
                const rows = g.rows.filter((r) => showAll || r.budget !== 0 || r.spent !== 0 || r.rollover !== 0);
                if (!rows.length) return null;
                const isOpen = open[g.groupId] !== false;
                return (
                  <div key={g.groupId}>
                    <button className="budgetrow" style={{ background: 'var(--color-surface-sunken)' }} aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.groupId]: !isOpen })}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}><LuChevronDown aria-hidden="true" style={{ transform: isOpen ? 'none' : 'rotate(-90deg)' }} />{g.name}</span>
                      <span className="rt num sm">{money(g.budget)}</span>
                      <span className={`rt num sm ${g.remaining < 0 ? 'neg' : ''}`}>{money(g.remaining)}</span>
                    </button>
                    {isOpen ? rows.map((r) => (
                      <div key={r.categoryId} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <button className="budgetrow" style={{ borderTop: 0 }} onClick={() => setEdit(r)} aria-label={`${r.name}: presupuesto ${money(r.budget)}, gastado ${money(r.spent)}, ${r.remaining >= 0 ? 'quedan' : 'te pasas'} ${money(Math.abs(r.remaining))}. Editar`}>
                          <span>{r.name}{r.hasRollover ? <LuRepeat aria-hidden="true" size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> : null}<span className="xs muted" style={{ display: 'block' }}>{money(r.spent)} gastado{r.rollover ? ` · arrastre ${money(r.rollover)}` : ''}</span></span>
                          <span className="amt num sm" aria-hidden="true">{money(r.budget)}</span>
                          <span className={`rt num sm b6 ${r.remaining < 0 ? 'neg' : 'pos'}`} aria-hidden="true">{r.remaining < 0 ? '▲ ' : ''}{money(r.remaining)}</span>
                        </button>
                        <div style={{ padding: '0 16px 10px' }}><ProgressBar spent={r.spent} budget={r.budget + r.rollover} label={`Uso de ${r.name}`} /></div>
                      </div>
                    )) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {hiddenCount > 0 && !showAll ? <Button variant="ghost" onClick={() => setShowAll(true)}>Mostrar {hiddenCount} sin presupuesto</Button> : showAll ? <Button variant="ghost" onClick={() => setShowAll(false)}>Ocultar las vacías</Button> : null}
        <p className="xs muted">El presupuesto está en céntimos exactos. Los traspasos y las transacciones ocultas no cuentan.</p>
      </main>
      {edit ? <EditBudget row={edit} month={month} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function Summ({ label, done, plan, doneLabel, expense }: { label: string; done: number; plan: number; doneLabel: string; expense?: boolean }) {
  const rest = plan - done;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b className="sm">{label}</b><span className="sm muted">{money(plan)} previstos</span></div>
      <div style={{ margin: '6px 0' }}><ProgressBar spent={expense ? done : done} budget={plan} label={`${label} frente a lo previsto`} /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="sm">{doneLabel} <b className="num">{money(done)}</b></span><span className={`sm ${rest < 0 && expense ? 'neg' : ''}`}>{rest >= 0 ? `Restan ${money(rest)}` : expense ? `Te pasas ${money(-rest)}` : `${money(-rest)} más de lo previsto`}</span></div>
    </div>
  );
}

function EditBudget({ row, month, onClose }: { row: BudgetRow; month: string; onClose: () => void }) {
  const s = useData();
  const [v, setV] = useState((row.budget / 100).toFixed(2).replace('.', ','));
  const [fwd, setFwd] = useState(false);
  const [roll, setRoll] = useState(row.hasRollover);
  const [err, setErr] = useState<string | null>(null);
  void s;
  const save = async () => {
    const c = parseCents(v);
    if (c === null || c < 0) return setErr('Escribe un importe válido, por ejemplo 250,00.');
    try {
      await setBudget(row.categoryId, month, c, fwd);
      if (roll !== row.hasRollover) await setRollover(row.categoryId, roll, month);
      toast('Presupuesto guardado'); onClose();
    } catch (e) { setErr(e instanceof ValidationError ? e.message : 'No se ha podido guardar.'); }
  };
  return (
    <Sheet title={row.name} onClose={onClose}>
      <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field id="bm" label={`Presupuesto de ${formatMonth(month).toLowerCase()}`} error={err}>{(p) => <input {...p} className="input num" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} autoFocus />}</Field>
        <label style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 48 }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={fwd} onChange={(e) => setFwd(e.target.checked)} />Aplicar también a los meses siguientes</label>
        <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minHeight: 48 }}><input type="checkbox" style={{ width: 22, height: 22, marginTop: 2 }} checked={roll} onChange={(e) => setRoll(e.target.checked)} /><span>Arrastrar lo que sobre o falte al mes siguiente<span className="hint" style={{ display: 'block' }}>Útil para gastos que no son mensuales, como seguros o regalos.</span></span></label>
        {row.rollover ? <p className="hint">Arrastre actual: {money(row.rollover)}.</p> : null}
        <div className="btnrow"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Sheet>
  );
}
void Banner;
