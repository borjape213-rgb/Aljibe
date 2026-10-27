import { useEffect, useRef, useState } from 'react';
import { LuArrowLeft, LuBell, LuCalendarCheck, LuDownload, LuMenu, LuSettings, LuListChecks, LuTag, LuSlidersHorizontal } from 'react-icons/lu';
import { BAR_SLOTS, DESTS, navOrder } from '../nav.ts';
import { back, useRoute } from '../router.tsx';
import { useData } from '../store.ts';
import { IconButton } from '../ui.tsx';
import { needsCategory } from '../logic/review.ts';

export function TopBar({ title, back: backTo, end }: { title: string; back?: string; end?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const s = useData();
  const review = s.transactions.filter(needsCategory).length;
  return (
    <>
      <header className="topbar">
        <div className="side">
          {backTo ? <IconButton label="Volver" onClick={() => back(backTo)}><LuArrowLeft /></IconButton> : <IconButton label="Abrir menú" onClick={() => setOpen(true)} aria-haspopup="dialog"><LuMenu /></IconButton>}
          {!backTo ? <IconButton label="Transacciones sin categoría" badge={review} onClick={() => { location.hash = '#/review'; }}><LuBell /></IconButton> : null}
        </div>
        <h1>{title}</h1>
        <div className="side end">{end}</div>
      </header>
      {open ? <Drawer onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const r = useRoute();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a,button');
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  const h = r.path.join('/');
  const st = useData();
  const rest = navOrder(st.settings).slice(BAR_SLOTS).map((id) => ({ href: `#${DESTS[id].path}`, label: DESTS[id].label, icon: DESTS[id].icon, on: DESTS[id].roots.includes(r.path[0] ?? '') }));
  const items = [
    ...rest,
    { href: '#/month-review', label: 'Revisión del mes', icon: LuCalendarCheck, on: h === 'month-review' },
    { href: '#/review', label: 'Sin categoría', icon: LuListChecks, on: h === 'review' },
    { href: '#/settings/categories', label: 'Categorías', icon: LuTag, on: h === 'settings/categories' },
    { href: '#/settings/rules', label: 'Reglas y etiquetas', icon: LuSlidersHorizontal, on: h === 'settings/rules' },
    { href: '#/settings/data', label: 'Datos y copia', icon: LuDownload, on: h === 'settings/data' },
    { href: '#/settings', label: 'Ajustes', icon: LuSettings, on: h === 'settings' },
  ];
  return (
    <div className="sheetback" style={{ alignItems: 'stretch', justifyContent: 'flex-start' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} >
      <nav ref={ref} className="drawer" aria-label="Menú" style={{ position: 'relative', height: '100%' }}>
        <div style={{ padding: '8px 12px 12px', fontWeight: 700 }}>Aljibe</div>
        {items.map((i) => <a key={i.href} href={i.href} aria-current={i.on ? 'page' : undefined} onClick={onClose}><i.icon aria-hidden="true" size={20} />{i.label}</a>)}
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={onClose}>Cerrar menú</button>
      </nav>
    </div>
  );
}
