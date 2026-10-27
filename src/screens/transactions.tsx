import { useMemo, useState } from 'react';
import { LuPlus, LuSearch, LuListFilter, LuCheck, LuSplit, LuEyeOff, LuTrash2, LuX } from 'react-icons/lu';
import type { Id, Split, State } from '../logic/types.ts';
import { go, setQuery, type Route } from '../router.tsx';
import { useData } from '../store.ts';
import { parseCents, formatCents } from '../logic/money.ts';
import { catIndex } from '../logic/ledger.ts';
import { todayISO, formatDay } from '../logic/dates.ts';
import { Amount, Banner, Button, Chip, EmptyState, Field, IconButton, Segmented, Sheet, money, toast } from '../ui.tsx';
import { TopBar } from './shell.tsx';
import { CategoryPicker, DayGroups, useNames } from './common.tsx';
import { categorizeUncategorized, createTransaction, deleteTransaction, setSplits, updateTransactions, ValidationError } from '../actions.ts';

const PAGE = 60;

export function Transactions({ route }: { route: Route }) {
  const s = useData();
  const q = route.query.get('q') ?? '';
  const acc = route.query.get('acc') ?? '';
  const cat = route.query.get('cat') ?? '';
  const status = route.query.get('st') ?? '';
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [filters, setFilters] = useState(false);
  const [sel, setSel] = useState<Set<Id> | null>(null);
  const [bulk, setBulk] = useState(false);
  const { kindOf } = catIndex(s);
  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return s.transactions.filter((t) => (!ql || t.merchant.toLowerCase().includes(ql) || t.notes.toLowerCase().includes(ql)) && (!acc || t.accountId === acc) && (!cat || t.categoryId === cat || t.splits.some((p) => p.categoryId === cat)) && (!status || (status === 'review' ? t.needsReview : status === 'hidden' ? t.hidden : true)));
  }, [s.transactions, q, acc, cat, status]);
  const active = [acc, cat, status].filter(Boolean).length;
  void kindOf;
  const toggle = (id: Id) => setSel((cur) => { const n = new Set(cur ?? []); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <>
      <TopBar title="Movimientos" end={<><IconButton label="Filtros" onClick={() => setFilters(true)} badge={active || undefined}><LuListFilter /></IconButton><IconButton label="Añadir transacción" onClick={() => setAdding(true)}><LuPlus /></IconButton></>} />
      <main>
        <div style={{ position: 'relative' }}>
          <LuSearch aria-hidden="true" style={{ position: 'absolute', left: 14, top: 14 }} />
          <input className="input" style={{ paddingLeft: 42 }} type="search" aria-label="Buscar por comerciante o nota" placeholder="Buscar" value={q} onChange={(e) => setQuery('q', e.target.value)} />
        </div>
        <div className="btnrow" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="sm muted" aria-live="polite">{items.length} {items.length === 1 ? 'transacción' : 'transacciones'}{active ? ' con filtros' : ''}</span>
          {sel ? <><Button variant="ghost" onClick={() => setSel(null)}>Cancelar</Button><Button disabled={!sel.size} onClick={() => setBulk(true)}>Cambiar categoría ({sel.size})</Button></> : <Button variant="ghost" onClick={() => setSel(new Set())} disabled={!items.length}>Seleccionar</Button>}
        </div>
        {s.transactions.length === 0 ? <EmptyState title="Todavía no has apuntado nada" text="Apunta un movimiento con el botón + o impórtalos desde un CSV en Ajustes." action={<Button onClick={() => setAdding(true)}>Añadir transacción</Button>} /> : items.length === 0 ? (
          <EmptyState title="Ningún resultado" text="Prueba con otra búsqueda o quita algún filtro." action={<Button variant="secondary" onClick={() => { location.hash = '#/transactions'; }}>Quitar filtros</Button>} />
        ) : (
          <>
            <DayGroups items={items.slice(0, limit)} s={s} showAccount selectable={!!sel} selected={sel ?? undefined} onToggle={toggle} />
            {items.length > limit ? <Button variant="secondary" onClick={() => setLimit(limit + PAGE)}>Mostrar más ({items.length - limit})</Button> : null}
          </>
        )}
      </main>
      {adding ? <TxForm s={s} onClose={() => setAdding(false)} /> : null}
      {filters ? (
        <Sheet title="Filtros" onClose={() => setFilters(false)}>
          <div className="form">
            <Field id="fa" label="Cuenta">{(p) => <select {...p} className="input" value={acc} onChange={(e) => setQuery('acc', e.target.value)}><option value="">Todas</option>{s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}</Field>
            <Field id="fc" label="Categoría">{(p) => <select {...p} className="input" value={cat} onChange={(e) => setQuery('cat', e.target.value)}><option value="">Todas</option>{s.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
            <div className="field"><span className="lbl">Estado</span><div className="chips wrap">{[['', 'Todos'], ['review', 'Por revisar'], ['hidden', 'Ocultas']].map(([v, l]) => <Chip key={v} selected={status === v} onClick={() => setQuery('st', v)}>{l}</Chip>)}</div></div>
            <div className="btnrow"><Button variant="secondary" onClick={() => { location.hash = '#/transactions'; setFilters(false); }}>Quitar filtros</Button><Button onClick={() => setFilters(false)}>Ver resultados</Button></div>
          </div>
        </Sheet>
      ) : null}
      {bulk && sel ? <BulkSheet s={s} ids={[...sel]} onClose={(done) => { setBulk(false); if (done) setSel(null); }} /> : null}
    </>
  );
}

function BulkSheet({ s, ids, onClose }: { s: State; ids: Id[]; onClose: (done: boolean) => void }) {
  const [c, setC] = useState('c-groceries');
  return (
    <Sheet title={`Cambiar categoría de ${ids.length}`} onClose={() => onClose(false)}>
      <div className="form">
        <Field id="bc" label="Nueva categoría">{() => <CategoryPicker s={s} value={c} onChange={setC} />}</Field>
        <p className="hint">Las transacciones divididas pierden la división.</p>
        <div className="btnrow"><Button variant="secondary" onClick={() => onClose(false)}>Cancelar</Button><Button onClick={async () => { const n = await updateTransactions(ids, { categoryId: c }); toast(`${ids.length} transacciones actualizadas${n ? `, y ${n} más sin categoría del mismo comercio` : ''}`); onClose(true); }}>Aplicar</Button></div>
      </div>
    </Sheet>
  );
}

function TxForm({ s, onClose }: { s: State; onClose: () => void }) {
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [account, setAccount] = useState(s.accounts.find((a) => a.group === 'cash' || a.group === 'credit')?.id ?? s.accounts[0]?.id ?? '');
  const [category, setCategory] = useState('c-groceries');
  const [err, setErr] = useState<Record<string, string>>({});
  if (!s.accounts.length) return <Sheet title="Nueva transacción" onClose={onClose}><Banner tone="warn">Primero crea una cuenta en la pestaña Cuentas.</Banner></Sheet>;
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!merchant.trim()) e.merchant = 'Escribe un comerciante.';
    const c = parseCents(amount);
    if (c === null || c === 0) e.amount = 'Escribe un importe válido distinto de cero, por ejemplo 12,50.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = 'Elige una fecha.';
    setErr(e);
    if (Object.keys(e).length) return;
    try {
      await createTransaction({ accountId: account, date, amountCents: kind === 'expense' ? -Math.abs(c!) : Math.abs(c!), merchant, categoryId: category });
      toast('Apuntado'); onClose();
    } catch (x) { setErr({ merchant: x instanceof ValidationError ? x.message : 'No se ha podido guardar.' }); }
  };
  return (
    <Sheet title="Nueva transacción" onClose={onClose}>
      <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Segmented label="Tipo" value={kind} onChange={(k) => { setKind(k); setCategory(k === 'income' ? 'c-salary' : 'c-groceries'); }} options={[{ id: 'expense', label: 'Gasto' }, { id: 'income', label: 'Ingreso' }]} />
        <Field id="tm" label="Comerciante" error={err.merchant}>{(p) => <input {...p} className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} autoFocus maxLength={120} />}</Field>
        <Field id="ta" label="Importe" error={err.amount}>{(p) => <input {...p} className="input num" inputMode="decimal" value={amount} placeholder="0,00" onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field id="td" label="Fecha" error={err.date}>{(p) => <input {...p} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field id="tc" label="Cuenta">{(p) => <select {...p} className="input" value={account} onChange={(e) => setAccount(e.target.value)}>{s.accounts.filter((a) => a.group !== 'investments').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}</Field>
        <Field id="tg" label="Categoría">{() => <CategoryPicker s={s} value={category} onChange={setCategory} kind={kind} />}</Field>
        <div className="btnrow"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Sheet>
  );
}

export function TransactionDetail({ id }: { id: string }) {
  const s = useData();
  const t = s.transactions.find((x) => x.id === id);
  const names = useNames(s);
  const [merchant, setMerchant] = useState(t?.merchant ?? '');
  const [notes, setNotes] = useState(t?.notes ?? '');
  const [confirm, setConfirm] = useState(false);
  if (!t) return <><TopBar title="Transacción" back="/transactions" /><main><Banner tone="warn">No encontramos esa transacción. <a href="#/transactions">Volver a la lista</a></Banner></main></>;
  const save = async (patch: Parameters<typeof updateTransactions>[1]) => { const n = await updateTransactions([t.id], patch); if (n) toast(`${n} más sin categoría del mismo comercio, también actualizadas`); };
  return (
    <>
      <TopBar title="Transacción" back="/transactions" />
      <main>
        <section className="card pad" aria-label="Resumen">
          <div className="xl b6"><Amount cents={t.amountCents} signed /></div>
          <div className="muted sm">{formatDay(t.date)} · {names.acc(t.accountId)}</div>
          {t.splits.length ? <p className="sm" style={{ margin: '8px 0 0' }}>Dividida en {t.splits.length} partes.</p> : null}
        </section>
        <section className="card pad form" aria-label="Detalles">
          <Field id="dm" label="Comerciante">{(p) => <input {...p} className="input" value={merchant} maxLength={120} onChange={(e) => setMerchant(e.target.value)} onBlur={() => merchant.trim() && merchant !== t.merchant && save({ merchant: merchant.trim() })} />}</Field>
          {t.splits.length === 0 ? <Field id="dc" label="Categoría">{() => <CategoryPicker s={s} value={t.categoryId} onChange={(c) => save({ categoryId: c })} />}</Field> : <div className="field"><span className="lbl">Categorías</span>{t.splits.map((p, i) => <div key={i} className="sm" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{names.cat(p.categoryId)}</span><Amount cents={p.amountCents} signed /></div>)}</div>}
          <div className="field"><span className="lbl">Etiquetas</span><div className="chips wrap">{s.tags.map((tg) => <Chip key={tg.id} selected={t.tags.includes(tg.id)} onClick={() => save({ tags: t.tags.includes(tg.id) ? t.tags.filter((x) => x !== tg.id) : [...t.tags, tg.id] })}>{tg.name}</Chip>)}{s.tags.length === 0 ? <span className="hint">Crea etiquetas en Ajustes.</span> : null}</div></div>
          <Field id="dn" label="Notas">{(p) => <textarea {...p} className="input" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== t.notes && save({ notes })} />}</Field>
          <label style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 48 }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={t.needsReview} onChange={(e) => save({ needsReview: e.target.checked })} />Marcar como pendiente de revisar</label>
        </section>
        <div className="btnrow">
          <a className="btn secondary" href={`#/transaction/${t.id}/split`}><LuSplit aria-hidden="true" size={18} />{t.splits.length ? 'Editar división' : 'Dividir'}</a>
          <Button variant="secondary" onClick={() => save({ hidden: !t.hidden })}><LuEyeOff aria-hidden="true" size={18} />{t.hidden ? 'Mostrar' : 'Ocultar'}</Button>
        </div>
        {t.hidden ? <Banner tone="info">Oculta: no cuenta en el flujo de caja ni en el presupuesto.</Banner> : null}
        <Button variant="danger" onClick={() => setConfirm(true)}><LuTrash2 aria-hidden="true" size={18} />Borrar transacción</Button>
      </main>
      {confirm ? (
        <Sheet title="¿Borrar esta transacción?" onClose={() => setConfirm(false)}>
          <p>Se restará del saldo de la cuenta. No se puede deshacer.</p>
          <div className="btnrow"><Button variant="secondary" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="danger" onClick={async () => { await deleteTransaction(t.id); toast('Transacción borrada'); go('/transactions'); }}>Borrar</Button></div>
        </Sheet>
      ) : null}
    </>
  );
}

export function SplitScreen({ id }: { id: string }) {
  const s = useData();
  const t = s.transactions.find((x) => x.id === id);
  const [parts, setParts] = useState<{ cat: Id; amount: string; note: string }[]>(() => t ? (t.splits.length ? t.splits : [{ categoryId: t.categoryId, amountCents: t.amountCents }, { categoryId: 'c-none', amountCents: 0 }]).map((p) => ({ cat: p.categoryId, amount: p.amountCents ? formatCents(Math.abs(p.amountCents), 'EUR').replace(/[^\d,.]/g, '') : '', note: ('note' in p && p.note) || '' })) : []);
  const [err, setErr] = useState<string | null>(null);
  if (!t) return <><TopBar title="Dividir" back="/transactions" /><main><Banner tone="warn">No encontramos esa transacción.</Banner></main></>;
  const sign = Math.sign(t.amountCents);
  const cents = parts.map((p) => parseCents(p.amount));
  const sum = cents.reduce<number>((n, c) => n + (c ?? 0) * sign, 0);
  const diff = t.amountCents - sum;
  const valid = cents.every((c) => c !== null && c !== 0) && diff === 0 && parts.length >= 2;
  const save = async () => {
    try {
      await setSplits(t.id, parts.map((p, i) => ({ categoryId: p.cat, amountCents: Math.abs(cents[i]!) * sign, note: p.note || undefined } as Split)));
      toast('División guardada'); go(`/transaction/${t.id}`);
    } catch (x) { setErr(x instanceof ValidationError ? x.message : 'No se ha podido guardar.'); }
  };
  return (
    <>
      <TopBar title="Dividir transacción" back={`/transaction/${t.id}`} />
      <main>
        <section className="card pad"><div className="sm muted">{t.merchant}</div><div className="lg b6"><Amount cents={t.amountCents} signed /></div></section>
        {parts.map((p, i) => (
          <section key={i} className="card pad form" aria-label={`Parte ${i + 1}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b>Parte {i + 1}</b>{parts.length > 2 ? <IconButton label={`Quitar parte ${i + 1}`} onClick={() => setParts(parts.filter((_, j) => j !== i))}><LuX /></IconButton> : null}</div>
            <Field id={`sc${i}`} label="Categoría">{() => <CategoryPicker s={s} value={p.cat} onChange={(c) => setParts(parts.map((x, j) => (j === i ? { ...x, cat: c } : x)))} />}</Field>
            <Field id={`sa${i}`} label="Importe" error={p.amount && cents[i] === null ? 'Importe no válido.' : null}>{(f) => <input {...f} className="input num" inputMode="decimal" value={p.amount} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />}</Field>
            <Field id={`sn${i}`} label="Nota (opcional)">{(f) => <input {...f} className="input" value={p.note} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />}</Field>
          </section>
        ))}
        <Button variant="secondary" onClick={() => setParts([...parts, { cat: 'c-none', amount: '', note: '' }])}><LuPlus aria-hidden="true" size={18} />Añadir parte</Button>
        {diff !== 0 ? <Banner tone="warn">{diff * sign > 0 ? `Faltan ${money(Math.abs(diff))} por repartir.` : `Te pasas ${money(Math.abs(diff))}.`}</Banner> : <Banner tone="ok">Las partes suman el total.</Banner>}
        {err ? <Banner tone="bad">{err}</Banner> : null}
        <div className="btnrow">
          {t.splits.length ? <Button variant="secondary" onClick={async () => { await setSplits(t.id, []); toast('División quitada'); go(`/transaction/${t.id}`); }}>Quitar división</Button> : null}
          <Button disabled={!valid} onClick={save}>Guardar</Button>
        </div>
      </main>
    </>
  );
}

export function Review() {
  const s = useData();
  const names = useNames(s);
  const [skipped, setSkipped] = useState<Id[]>([]);
  const queue = s.transactions.filter((t) => t.needsReview && !skipped.includes(t.id));
  const uncategorized = s.transactions.filter((x) => x.categoryId === 'c-none' && !x.hidden).length;
  const t = queue[0];
  const [done, setDone] = useState(0);
  const total = queue.length + done;
  return (
    <>
      <TopBar title={t ? `${queue.length} por revisar` : 'Revisión'} back="/" />
      <main>
        {!t ? <EmptyState icon={<LuCheck size={32} aria-hidden="true" />} title="Todo al día" text={skipped.length ? `Has saltado ${skipped.length}. Siguen marcadas por revisar.` : 'No queda nada pendiente.'} action={<>{skipped.length ? <Button variant="secondary" onClick={() => setSkipped([])}>Volver a las saltadas</Button> : null}<a className="btn" href="#/">Volver al inicio</a></>} /> : (
          <>
            {uncategorized ? <Banner tone="info" onClick={async () => { const r = await categorizeUncategorized(); toast(r.assigned ? `Categorizados ${r.assigned}${r.remaining ? `; ${r.remaining} siguen sin categoría` : ''}` : 'No reconozco ninguno; elige categoría y aprenderé de ello'); }}>{uncategorized} sin categoría. Toca para categorizarlas automáticamente.</Banner> : null}
            <div className="progress" role="progressbar" aria-label="Avance de la revisión" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><i style={{ width: `${total ? (done / total) * 100 : 0}%`, background: 'var(--color-accent)' }} /></div>
            <section className="card pad form" aria-label="Transacción a revisar">
              <div><div className="lg b6">{t.merchant}</div><div className="sm muted">{formatDay(t.date)} · {names.acc(t.accountId)}</div><div className="xl b6"><Amount cents={t.amountCents} signed /></div></div>
              <div className="field"><span className="lbl">Categoría</span><CategoryPicker s={s} value={t.categoryId} onChange={async (c) => { const n = await updateTransactions([t.id], { categoryId: c, needsReview: true }); if (n) toast(`${n} más sin categoría del mismo comercio, también actualizadas`); }} /></div>
              <div className="field"><span className="lbl">Etiquetas</span><div className="chips wrap">{s.tags.map((tg) => <Chip key={tg.id} selected={t.tags.includes(tg.id)} onClick={() => void updateTransactions([t.id], { tags: t.tags.includes(tg.id) ? t.tags.filter((x) => x !== tg.id) : [...t.tags, tg.id] })}>{tg.name}</Chip>)}</div></div>
              {t.categoryId === 'c-none' ? <Banner tone="warn">Esta transacción no tiene categoría.</Banner> : null}
              <a className="sm" href={`#/transaction/${t.id}`}>Abrir detalle completo</a>
            </section>
            <div className="btnrow"><Button variant="secondary" onClick={() => setSkipped([...skipped, t.id])}>Saltar por ahora</Button><Button onClick={async () => { await updateTransactions([t.id], { needsReview: false }); setDone(done + 1); }}>Marcar como revisada</Button></div>
          </>
        )}
      </main>
    </>
  );
}
