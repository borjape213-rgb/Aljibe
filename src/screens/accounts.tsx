import { useMemo, useState } from 'react';
import { LuPlus, LuEyeOff, LuLandmark, LuTrendingUp, LuBuilding, LuWallet, LuTrash2 } from 'react-icons/lu';
import type { Account, AccountGroup, State } from '../logic/types.ts';
import type { Route } from '../router.tsx';
import { go, setQuery } from '../router.tsx';
import { useData } from '../store.ts';
import { GROUP_LABEL, GROUP_ORDER, accountSeries, accountValueCents, changeOver, isManualInvestment, netWorthSeries } from '../logic/ledger.ts';
import { addDays, todayISO } from '../logic/dates.ts';
import { parseCents } from '../logic/money.ts';
import { Amount, Avatar, Banner, Button, Change, EmptyState, Field, IconButton, Ranges, Segmented, Sheet, Skeleton, Tabs, money, toast } from '../ui.tsx';
import { AreaChart, CHART_COLORS, Sparkline, StackedBar } from '../charts.tsx';
import { TopBar } from './shell.tsx';
import { DayGroups, relTime } from './common.tsx';
import { deleteAccount, saveAccount, ValidationError } from '../actions.ts';

const RANGES = [{ id: '1m', label: '1M', days: 30 }, { id: '3m', label: '3M', days: 91 }, { id: '6m', label: '6M', days: 182 }, { id: '1y', label: '1A', days: 365 }, { id: 'all', label: 'Todo', days: 399 }] as const;
const RANGE_TEXT: Record<string, string> = { '1m': '1 mes', '3m': '3 meses', '6m': '6 meses', '1y': '1 año', all: 'todo el periodo' };
type Tab = 'net' | 'cash' | 'investments' | 'assets';
const TAB_GROUPS: Record<Tab, AccountGroup[]> = { net: GROUP_ORDER, cash: ['cash'], investments: ['investments'], assets: ['assets'] };

export function Accounts({ route }: { route: Route }) {
  const s = useData();
  const tab = (route.query.get('tab') as Tab) || 'net';
  const rangeId = route.query.get('range') || '1m';
  const days = RANGES.find((r) => r.id === rangeId)?.days ?? 30;
  const today = todayISO();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'totals' | 'percent'>('totals');
  const groups = TAB_GROUPS[tab] ?? GROUP_ORDER;
  const visible = s.accounts.filter((a) => !a.hidden && groups.includes(a.group));
  const series = useMemo(() => {
    const from = addDays(today, -days);
    if (tab === 'net') return netWorthSeries(s, from, today).map((p) => ({ date: p.date, value: p.net }));
    const accs = visible;
    if (!accs.length) return [];
    const ss = accs.map((a) => accountSeries(s, a, from, today));
    return ss[0].map((p, i) => ({ date: p.date, value: ss.reduce((n, x) => n + x[i].cents, 0) }));
  }, [s, tab, days, today, visible.length]);
  const total = visible.reduce((n, a) => n + accountValueCents(s, a), 0);
  const ch = changeOver(series.map((p) => ({ cents: p.value })));
  const assetsTotal = s.accounts.filter((a) => !a.hidden).reduce((n, a) => { const v = accountValueCents(s, a); return v > 0 ? n + v : n; }, 0);

  return (
    <>
      <TopBar title="Cuentas" end={<IconButton label="Añadir cuenta" onClick={() => setAdding(true)}><LuPlus /></IconButton>} />
      <main>
        <Tabs value={tab} onChange={(v) => setQuery('tab', v === 'net' ? null : v)} options={[{ id: 'net', label: 'Patrimonio' }, { id: 'cash', label: 'Efectivo' }, { id: 'investments', label: 'Inversiones' }, { id: 'assets', label: 'Bienes' }]} />
        {s.accounts.length === 0 ? (
          <EmptyState icon={<LuLandmark size={32} aria-hidden="true" />} title="Aún no tienes cuentas" text="Empieza por una: tu cuenta corriente, una tarjeta o un bien. Tú pones el saldo y Aljibe hace el resto." action={<Button onClick={() => setAdding(true)}>Añadir cuenta</Button>} />
        ) : (
          <>
            <section aria-label={tab === 'net' ? 'Patrimonio neto' : GROUP_LABEL[groups[0]]}>
              <div className="xl b6"><Amount cents={total} tone="none" /></div>
              <Change pct={ch.pct} cents={ch.delta} label={RANGE_TEXT[rangeId]} goodWhen="up" />
              <AreaChart points={series} label={tab === 'net' ? 'Patrimonio neto' : `Total de ${GROUP_LABEL[groups[0]].toLowerCase()}`} />
              <Ranges value={rangeId as 'all'} onChange={(v) => setQuery('range', v === '1m' ? null : v)} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
            </section>
            {tab === 'net' ? <Summary s={s} mode={mode} setMode={setMode} /> : null}
            {visible.length === 0 ? <EmptyState title="Nada en esta categoría" text="Añade una cuenta de este tipo con el botón +." /> : null}
            {groups.map((g) => {
              const accs = visible.filter((a) => a.group === g);
              if (!accs.length) return null;
              const gtotal = accs.reduce((n, a) => n + accountValueCents(s, a), 0);
              const gs = accs.map((a) => accountSeries(s, a, addDays(today, -days), today));
              const gch = changeOver(gs[0].map((_, i) => ({ cents: gs.reduce((n, x) => n + x[i].cents, 0) })));
              const liab = g === 'credit' || g === 'loans';
              return (
                <section key={g} className="card" aria-label={GROUP_LABEL[g]}>
                  <div className="cardhead" style={{ alignItems: 'flex-start' }}>
                    <div><h2>{GROUP_LABEL[g]}</h2><Change pct={gch.pct} cents={gch.delta} label={RANGE_TEXT[rangeId]} goodWhen={liab ? 'up' : 'up'} /></div>
                    <div style={{ textAlign: 'right' }}><div className="b6"><Amount cents={gtotal} tone="none" /></div>{!liab && assetsTotal ? <span className="xs muted">{Math.round((gtotal / assetsTotal) * 100)} % de los activos</span> : null}</div>
                  </div>
                  {accs.map((a, i) => (
                    <a key={a.id} className="row" href={`#/account/${a.id}`}>
                      <Avatar name={a.name}>{g === 'investments' ? <LuTrendingUp /> : g === 'assets' ? <LuBuilding /> : undefined}</Avatar>
                      <span className="grow"><span className="title">{a.name}</span><span className="xs muted">{a.subtype}</span></span>
                      <Sparkline values={gs[i].map((p) => p.cents)} width={48} />
                      <span className="end"><Amount cents={accountValueCents(s, a)} tone="none" liability={liab} /><br /><span className="xs muted">{relTime(a.updatedAt)}</span></span>
                    </a>
                  ))}
                </section>
              );
            })}
            {s.accounts.some((a) => a.hidden) ? <p className="xs muted">Hay {s.accounts.filter((a) => a.hidden).length} cuentas ocultas. Se muestran dentro de su ficha.</p> : null}
          </>
        )}
      </main>
      {adding ? <AccountForm onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function Summary({ s, mode, setMode }: { s: State; mode: 'totals' | 'percent'; setMode: (m: 'totals' | 'percent') => void }) {
  const accs = s.accounts.filter((a) => !a.hidden);
  const rows = GROUP_ORDER.map((g) => ({ g, cents: accs.filter((a) => a.group === g).reduce((n, a) => n + accountValueCents(s, a), 0) }));
  const assets = rows.filter((r) => r.cents > 0), liabs = rows.filter((r) => r.cents < 0);
  const at = assets.reduce((n, r) => n + r.cents, 0), lt = liabs.reduce((n, r) => n + Math.abs(r.cents), 0);
  const Block = ({ title, items, total, color0 }: { title: string; items: typeof rows; total: number; color0: number }) => (
    <div>
      <div className="sechead"><span>{title}</span><Amount cents={items[0]?.cents < 0 ? -total : total} tone="none" /></div>
      <div style={{ padding: '12px 16px 4px' }}><StackedBar total={total} parts={items.map((r, i) => ({ label: GROUP_LABEL[r.g], cents: r.cents, color: CHART_COLORS[(color0 + i) % 8] }))} /></div>
      {items.map((r, i) => (
        <div key={r.g} className="lrow legend" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 16px' }}>
          <span className="dot" style={{ background: CHART_COLORS[(color0 + i) % 8] }} aria-hidden="true" />
          <span className="grow" style={{ flex: 1 }}>{GROUP_LABEL[r.g]}</span>
          {mode === 'totals' ? <Amount cents={r.cents} tone="none" /> : <span className="num">{total ? Math.round((Math.abs(r.cents) / total) * 100) : 0} %</span>}
        </div>
      ))}
    </div>
  );
  return (
    <section className="card" aria-label="Resumen de activos y pasivos">
      <div style={{ padding: 12 }}><Segmented label="Mostrar" value={mode} onChange={setMode} options={[{ id: 'totals', label: 'Totales' }, { id: 'percent', label: 'Porcentaje' }]} /></div>
      {assets.length ? <Block title="Activos" items={assets} total={at} color0={0} /> : null}
      {liabs.length ? <Block title="Pasivos" items={liabs} total={lt} color0={4} /> : null}
    </section>
  );
}

const SUBTYPES: Record<AccountGroup, string[]> = { cash: ['Cuenta corriente', 'Ahorro', 'Efectivo'], credit: ['Tarjeta de crédito'], loans: ['Préstamo', 'Hipoteca'], investments: ['Fondos', 'Jubilación', 'Cripto', 'Loans'], assets: ['Inmueble', 'Vehículo', 'Otro bien'], other: ['Otra'] };
export function AccountForm({ onClose, account }: { onClose: () => void; account?: Account }) {
  const [name, setName] = useState(account?.name ?? '');
  const [group, setGroup] = useState<AccountGroup>(account?.group ?? 'cash');
  const [subtype, setSubtype] = useState(account?.subtype ?? SUBTYPES.cash[0]);
  const [bal, setBal] = useState(account ? String(Math.abs(account.balanceCents) / 100).replace('.', ',') : '');
  const [hidden, setHidden] = useState(account?.hidden ?? false);
  const [err, setErr] = useState<{ name?: string; bal?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const liab = group === 'credit' || group === 'loans';
  const manual = isManualInvestment({ group, subtype });
  const byHoldings = group === 'investments' && !manual;
  const submit = async () => {
    const e: { name?: string; bal?: string } = {};
    if (!name.trim()) e.name = 'Escribe un nombre para la cuenta.';
    const c = bal.trim() === '' && !byHoldings ? null : parseCents(bal || '0');
    if (c === null) e.bal = 'Escribe un importe válido, por ejemplo 1.250,00.';
    if (e.name || e.bal) return setErr(e);
    setBusy(true);
    try {
      await saveAccount({ id: account?.id, name, group, subtype, balanceCents: byHoldings ? 0 : liab ? -Math.abs(c ?? 0) : c ?? 0, currency: account?.currency ?? 'EUR', hidden, valuations: account?.valuations });
      toast(account ? 'Cuenta actualizada' : 'Cuenta creada');
      onClose();
    } catch (x) { setErr({ name: x instanceof ValidationError ? x.message : 'No se ha podido guardar.' }); } finally { setBusy(false); }
  };
  return (
    <Sheet title={account ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Field id="an" label="Nombre" error={err?.name}>{(p) => <input {...p} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field id="ag" label="Tipo">{(p) => <select {...p} className="input" value={group} disabled={!!account} onChange={(e) => { const g = e.target.value as AccountGroup; setGroup(g); setSubtype(SUBTYPES[g][0]); }}>{(Object.keys(GROUP_LABEL) as AccountGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select>}</Field>
        <Field id="as" label="Subtipo">{(p) => <select {...p} className="input" value={subtype} onChange={(e) => setSubtype(e.target.value)}>{SUBTYPES[group].map((x) => <option key={x}>{x}</option>)}</select>}</Field>
        {byHoldings ? <p className="hint">El valor de una cuenta de inversión sale de sus posiciones. Añádelas en Inversiones.</p> : (
          <Field id="ab" label={liab ? 'Cantidad que debes' : manual ? 'Saldo (lo que te deben)' : 'Saldo actual'} error={err?.bal} hint={liab ? 'Escríbela en positivo; se guarda como deuda.' : undefined}>{(p) => <input {...p} className="input num" inputMode="decimal" value={bal} placeholder="0,00" onChange={(e) => setBal(e.target.value)} />}</Field>
        )}
        <label style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 48 }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Ocultar de los totales y del patrimonio</label>
        <div className="btnrow"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>Guardar</Button></div>
      </form>
    </Sheet>
  );
}

export function AccountDetail({ id, route }: { id: string; route: Route }) {
  const s = useData();
  const a = s.accounts.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const rangeId = route.query.get('range') || '3m';
  const days = RANGES.find((r) => r.id === rangeId)?.days ?? 91;
  const today = todayISO();
  const series = useMemo(() => (a ? accountSeries(s, a, addDays(today, -days), today).map((p) => ({ date: p.date, value: p.cents })) : []), [s, a, days, today]);
  if (!a) return <><TopBar title="Cuenta" back="/accounts" /><main><Banner tone="warn">No encontramos esa cuenta. Puede que se haya borrado. <a href="#/accounts">Volver a cuentas</a></Banner></main></>;
  const value = accountValueCents(s, a);
  const ch = changeOver(series.map((p) => ({ cents: p.value })));
  const txs = s.transactions.filter((t) => t.accountId === a.id).slice(0, 40);
  const liab = a.group === 'credit' || a.group === 'loans';
  const manual = isManualInvestment(a);
  return (
    <>
      <TopBar title={a.name} back="/accounts" end={<Button variant="ghost" onClick={() => setEdit(true)}>Editar</Button>} />
      <main>
        {a.hidden ? <Banner tone="info" icon={<LuEyeOff aria-hidden="true" />}>Esta cuenta está oculta del patrimonio y de los totales.</Banner> : null}
        <section aria-label="Saldo">
          <div className="xl b6"><Amount cents={value} tone="none" liability={liab} /></div>
          <Change pct={ch.pct} cents={ch.delta} label={RANGE_TEXT[rangeId]} />
          <AreaChart points={series} label={`Saldo de ${a.name}`} />
          <Ranges value={rangeId as 'all'} onChange={(v) => setQuery('range', v === '3m' ? null : v)} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
          <p className="xs muted" style={{ textAlign: 'center' }}>Actualizada {relTime(a.updatedAt)} · manual</p>
        </section>
        {manual ? <Button variant="secondary" onClick={() => setEdit(true)}>Actualizar saldo</Button> : null}
        {a.group === 'investments' && !manual ? <a className="btn secondary" href="#/investments">Ver posiciones</a> : null}
        {manual ? null : <h2 className="sm b6" style={{ margin: '4px 4px 0' }}>Transacciones</h2>}
        {manual ? null : txs.length === 0 ? <EmptyState title="Sin transacciones" text={a.group === 'assets' ? 'Los bienes se valoran a mano: edita la cuenta para guardar una nueva valoración.' : 'Esta cuenta no tiene movimientos todavía.'} /> : <DayGroups items={txs} s={s} />}
        <Button variant="danger" onClick={() => setConfirm(true)}><LuTrash2 aria-hidden="true" size={18} />Borrar cuenta</Button>
      </main>
      {edit ? <AccountForm account={a} onClose={() => setEdit(false)} /> : null}
      {confirm ? (
        <Sheet title="¿Borrar esta cuenta?" onClose={() => setConfirm(false)}>
          <p>Se borrarán también sus {s.transactions.filter((t) => t.accountId === a.id).length} transacciones y posiciones. No se puede deshacer; haz antes una copia de seguridad si no estás seguro.</p>
          <div className="btnrow"><Button variant="secondary" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="danger" onClick={async () => { await deleteAccount(a.id); toast('Cuenta borrada'); go('/accounts'); }}>Borrar</Button></div>
        </Sheet>
      ) : null}
    </>
  );
}
void Skeleton; void LuWallet; void money;
