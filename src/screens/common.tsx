import { LuSplit, LuStickyNote } from 'react-icons/lu';
import type { Account, Id, State, Transaction } from '../logic/types.ts';
import { catIndex } from '../logic/ledger.ts';
import { formatDay, formatShort } from '../logic/dates.ts';
import { Amount, Avatar } from '../ui.tsx';

export function relTime(iso: string, now = new Date()): string {
  const diff = (new Date(iso).getTime() - now.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 60) return rtf.format(Math.round(diff / 86400), 'day');
  return rtf.format(Math.round(diff / (86400 * 30)), 'month');
}

export function useNames(s: State) {
  const { cats, groups } = catIndex(s);
  const accs = new Map<Id, Account>(s.accounts.map((a) => [a.id, a]));
  return { cat: (id: Id) => cats.get(id)?.name ?? 'Sin categoría', group: (id: Id) => groups.get(cats.get(id)?.groupId ?? '')?.name ?? '', acc: (id: Id) => accs.get(id)?.name ?? 'Cuenta borrada' };
}

export function TxRow({ t, s, showAccount = false, showDate = false, selectable, selected, onToggle }: { t: Transaction; s: State; showAccount?: boolean; showDate?: boolean; selectable?: boolean; selected?: boolean; onToggle?: () => void }) {
  const n = useNames(s);
  const sub = [t.splits.length ? `${t.splits.length} partes` : n.cat(t.categoryId), showAccount ? n.acc(t.accountId) : null, showDate ? formatShort(t.date) : null].filter(Boolean).join(' · ');
  const body = (
    <>
      {selectable ? <input type="checkbox" checked={!!selected} onChange={onToggle} aria-label={`Seleccionar ${t.merchant}`} style={{ width: 22, height: 22 }} onClick={(e) => e.stopPropagation()} /> : null}
      <Avatar name={t.merchant} />
      <span className="grow">
        <span className="title">{t.merchant}</span>
        <span className="xs muted" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{sub}</span>
          {t.splits.length ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><LuSplit aria-hidden="true" size={12} /><span className="sr">Dividida</span></span> : null}
          {t.notes ? <span style={{ display: 'inline-flex' }}><LuStickyNote aria-hidden="true" size={12} /><span className="sr">Con nota</span></span> : null}
        </span>
      </span>
      <span className="end"><Amount cents={t.amountCents} signed /></span>
    </>
  );
  return selectable ? <label className="row" style={{ cursor: 'pointer' }}>{body}</label> : <a className="row" href={`#/transaction/${t.id}`}>{body}</a>;
}

export function DayGroups({ items, s, showAccount, flat, selectable, selected, onToggle }: { items: Transaction[]; s: State; showAccount?: boolean; flat?: boolean; selectable?: boolean; selected?: Set<Id>; onToggle?: (id: Id) => void }) {
  // flat: una sola lista en el orden recibido, con la fecha en cada fila (para ordenar por importe)
  if (flat) return <section className="card" aria-label="Transacciones">{items.map((t) => <TxRow key={t.id} t={t} s={s} showAccount={showAccount} showDate selectable={selectable} selected={selected?.has(t.id)} onToggle={() => onToggle?.(t.id)} />)}</section>;
  const byDay = new Map<string, Transaction[]>();
  for (const t of items) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
  return (
    <>
      {[...byDay.entries()].map(([day, ts]) => {
        const total = ts.reduce((n, t) => n + t.amountCents, 0);
        return (
          <section key={day} className="card" aria-label={formatDay(day)}>
            <div className="sechead"><span>{formatDay(day)}</span><Amount cents={total} signed tone="none" /></div>
            {ts.map((t) => <TxRow key={t.id} t={t} s={s} showAccount={showAccount} selectable={selectable} selected={selected?.has(t.id)} onToggle={() => onToggle?.(t.id)} />)}
          </section>
        );
      })}
    </>
  );
}
void formatShort;

export function CategoryPicker({ s, value, onChange, kind }: { s: State; value: Id; onChange: (id: Id) => void; kind?: 'income' | 'expense' }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Categoría">
      {s.groups.filter((g) => !kind || g.kind === kind || g.kind === 'transfer').map((g) => (
        <optgroup key={g.id} label={g.name}>{s.categories.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
      ))}
    </select>
  );
}
