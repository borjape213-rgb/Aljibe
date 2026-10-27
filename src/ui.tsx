import React, { useEffect, useRef, useState } from 'react';
import { LuArrowDown, LuArrowUp, LuCheck, LuCircleAlert, LuInfo, LuMinus, LuTriangleAlert, LuX } from 'react-icons/lu';
import { formatCents, spokenCents } from './logic/money.ts';
import { getState } from './store.ts';

export const cur = () => getState().settings.currency;
export const loc = () => getState().settings.locale;
export const money = (c: number, signed = false) => formatCents(c, cur(), { signed, locale: loc() });
export const moneyRound = (c: number) => new Intl.NumberFormat(loc(), { style: 'currency', currency: cur(), maximumFractionDigits: 0 }).format(c / 100).replace('-', '−');

export function Amount({ cents, signed = false, tone = 'auto', className = '', liability = false }: { cents: number; signed?: boolean; tone?: 'auto' | 'none'; className?: string; liability?: boolean }) {
  const cls = tone === 'auto' && cents > 0 && signed ? 'pos' : '';
  const spoken = liability ? `debes ${spokenCents(Math.abs(cents), cur(), loc()).replace(/^(más|menos) /, '')}` : spokenCents(cents, cur(), loc());
  return (
    <span className={`num ${cls} ${className}`} aria-label={spoken}>
      <span aria-hidden="true">{money(cents, signed)}</span>
    </span>
  );
}

export function Change({ pct, cents, label, goodWhen = 'up', pill = false }: { pct: number; cents?: number; label?: string; goodWhen?: 'up' | 'down'; pill?: boolean }) {
  const dir = Math.abs(pct) < 0.005 && !cents ? 'flat' : pct > 0 || (cents ?? 0) > 0 ? 'up' : 'down';
  const good = dir === 'flat' ? null : dir === goodWhen;
  const tone = good === null ? 'muted' : good ? 'pos' : 'neg';
  const Icon = dir === 'up' ? LuArrowUp : dir === 'down' ? LuArrowDown : LuMinus;
  const p = `${Math.abs(pct).toLocaleString(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  const amount = cents !== undefined ? `${money(Math.abs(cents))} ` : '';
  const verb = dir === 'up' ? 'sube' : dir === 'down' ? 'baja' : 'sin cambios';
  return (
    <span className={`change ${tone} ${pill ? `pill ${good === null ? 'flat' : good ? 'good' : 'bad'}` : ''}`} aria-label={`${verb} ${dir === 'flat' ? '' : amount + p}${label ? ' en ' + label : ''}`}>
      <Icon aria-hidden="true" />
      <span aria-hidden="true" className="num">{cents !== undefined ? `${amount}(${p})` : p}</span>
      {label && !pill ? <span aria-hidden="true" className="muted" style={{ fontWeight: 400 }}>{label}</span> : null}
    </span>
  );
}

export function Banner({ tone = 'info', children, href, onClick, icon }: { tone?: 'info' | 'ok' | 'warn' | 'bad'; children: React.ReactNode; href?: string; onClick?: () => void; icon?: React.ReactNode }) {
  const Icon = tone === 'ok' ? LuCheck : tone === 'warn' ? LuTriangleAlert : tone === 'bad' ? LuCircleAlert : LuInfo;
  const inner = <>{icon ?? <Icon aria-hidden="true" />}<span>{children}</span></>;
  if (href) return <a className={`banner ${tone}`} href={href}>{inner}</a>;
  if (onClick) return <button className={`banner ${tone}`} onClick={onClick}>{inner}</button>;
  return <div className={`banner ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>{inner}</div>;
}

export function Button({ variant = 'primary', block, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; block?: boolean }) {
  return <button type="button" {...p} className={`btn ${variant === 'primary' ? '' : variant} ${block ? 'block' : ''} ${p.className ?? ''}`} />;
}
export function IconButton({ label, children, badge, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: number }) {
  return (
    <button type="button" className="iconbtn" aria-label={badge ? `${label}, ${badge} pendientes` : label} {...p}>
      {children}
      {badge ? <span className="badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}
export function Chip({ selected, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return <button type="button" className="chip" aria-pressed={selected} {...p}>{selected ? <LuCheck aria-hidden="true" size={14} /> : null}{children}</button>;
}
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  );
}
export function Ranges<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return <div className="ranges" role="group" aria-label="Periodo">{options.map((o) => <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>;
}
export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return <div className="tabs" role="tablist">{options.map((o) => <button key={o.id} role="tab" className="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>;
}

export function Field({ label, error, hint, children, id }: { label: string; error?: string | null; hint?: string; children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => React.ReactNode; id: string }) {
  const msg = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': msg })}
      {error ? <span id={`${id}-e`} className="err" role="alert">{error}</span> : hint ? <span id={`${id}-h`} className="hint">{hint}</span> : null}
    </div>
  );
}

export function ProgressBar({ spent, budget, label }: { spent: number; budget: number; label: string }) {
  const ratio = budget > 0 ? spent / budget : spent > 0 ? 2 : 0;
  const state = ratio > 1 ? 'over' : ratio >= 0.9 ? 'near' : 'ok';
  return (
    <div className={`progress ${state === 'ok' ? '' : state}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))} aria-valuetext={`${Math.round(ratio * 100)} % usado`}>
      <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return <div className="empty">{icon}<h3>{title}</h3>{text ? <p>{text}</p> : null}{action}</div>;
}
export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skel" style={{ height: h, width: w }} aria-hidden="true" />;
}
export function Avatar({ name, children }: { name: string; children?: React.ReactNode }) {
  return <span className="avatar" aria-hidden="true">{children ?? name.trim().slice(0, 1).toUpperCase()}</span>;
}
export function SectionHeader({ title, right, rightSpoken }: { title: string; right?: React.ReactNode; rightSpoken?: string }) {
  return <div className="sechead" role="heading" aria-level={2} aria-label={[title, rightSpoken].filter(Boolean).join(', ')}><span>{title}</span>{right}</div>;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose suele ser una función nueva en cada render: va en una ref para que el efecto (y su foco inicial) corra una sola vez
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // foco al diálogo solo si ningún campo (autoFocus) lo ha cogido ya
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, []);
  return (
    <div className="sheetback" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="grab" aria-hidden="true" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{title}</h2>
          <IconButton label="Cerrar" onClick={onClose}><LuX /></IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

let toastSet: ((m: string | null) => void) | null = null;
export const toast = (m: string) => { toastSet?.(m); };
export function ToastHost() {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => { toastSet = setM; return () => { toastSet = null; }; }, []);
  useEffect(() => { if (!m) return; const t = setTimeout(() => setM(null), 3500); return () => clearTimeout(t); }, [m]);
  return m ? <div className="toast" role="status">{m}</div> : null;
}
