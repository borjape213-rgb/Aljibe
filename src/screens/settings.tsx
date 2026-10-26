import { useRef, useState } from 'react';
import { LuChevronRight, LuTrash2, LuPlus, LuDownload, LuUpload, LuArrowUp, LuArrowDown } from 'react-icons/lu';
import { BAR_SLOTS, DESTS, WIDGET_NAMES, navOrder, widgetOrder } from '../nav.ts';
import { parseXLSX } from '../logic/xlsx.ts';
import { isOLE, parseXLS } from '../logic/xls.ts';
import type { Route } from '../router.tsx';
import { useData } from '../store.ts';
import { findHeader, parseCSV, planImport, rowsFromCSV, type ImportRow } from '../logic/importer.ts';
import { Banner, Button, EmptyState, Field, IconButton, Segmented, Sheet, toast } from '../ui.tsx';
import { TopBar } from './shell.tsx';
import { CategoryPicker } from './common.tsx';
import { addRule, addTag, clearAll, markBackup, moveItem, deleteCategory, exportJSON, importJSON, importRows, removeRule, removeTag, resetSeed, saveCategory, updateSettings, ValidationError } from '../actions.ts';
import { todayISO } from '../logic/dates.ts';

export function Settings({ route }: { route: Route }) {
  const sub = route.path[1];
  if (sub === 'categories') return <Categories />;
  if (sub === 'rules') return <RulesTags />;
  if (sub === 'data') return <DataScreen />;
  if (sub === 'display') return <Display />;
  const items = [['categories', 'Categorías y grupos'], ['rules', 'Reglas y etiquetas'], ['data', 'Datos, importación y copia'], ['display', 'Pantalla y tema']];
  return (
    <>
      <TopBar title="Ajustes" />
      <main>
        <section className="card">{items.map(([k, l]) => <a key={k} className="row" href={`#/settings/${k}`}><span className="grow">{l}</span><LuChevronRight aria-hidden="true" /></a>)}</section>
        <p className="xs muted">Esta app guarda todo en tu dispositivo. No hay cuenta ni servidor: haz copias de seguridad desde Datos.</p>
      </main>
    </>
  );
}

function Categories() {
  const s = useData();
  const [edit, setEdit] = useState<{ id?: string; groupId: string; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <TopBar title="Categorías" back="/settings" end={<IconButton label="Añadir categoría" onClick={() => setEdit({ groupId: 'g-food', name: '' })}><LuPlus /></IconButton>} />
      <main>
        {s.groups.map((g) => (
          <section key={g.id} className="card" aria-label={g.name}>
            <div className="sechead"><span>{g.name}</span><span className="xs">{g.kind === 'income' ? 'Ingreso' : g.kind === 'transfer' ? 'Traspaso' : g.bucket === 'fixed' ? 'Fijo' : g.bucket === 'nonmonthly' ? 'No mensual' : 'Flexible'}</span></div>
            {s.categories.filter((c) => c.groupId === g.id).map((c) => <button key={c.id} className="row" onClick={() => { setErr(null); setEdit({ id: c.id, groupId: c.groupId, name: c.name }); }}><span className="grow">{c.name}</span><LuChevronRight aria-hidden="true" /></button>)}
          </section>
        ))}
      </main>
      {edit ? (
        <Sheet title={edit.id ? 'Editar categoría' : 'Nueva categoría'} onClose={() => setEdit(null)}>
          <form className="form" noValidate onSubmit={async (e) => { e.preventDefault(); try { await saveCategory(edit); toast('Categoría guardada'); setEdit(null); } catch (x) { setErr(x instanceof ValidationError ? x.message : 'No se ha podido guardar.'); } }}>
            <Field id="cn" label="Nombre" error={err}>{(p) => <input {...p} className="input" value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />}</Field>
            <Field id="cg" label="Grupo">{(p) => <select {...p} className="input" value={edit.groupId} onChange={(e) => setEdit({ ...edit, groupId: e.target.value })}>{s.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}</Field>
            <div className="btnrow">{edit.id && edit.id !== 'c-none' ? <Button variant="danger" onClick={async () => { await deleteCategory(edit.id!); toast('Categoría borrada; sus transacciones pasan a Sin categoría'); setEdit(null); }}>Borrar</Button> : null}<Button type="submit">Guardar</Button></div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}

function RulesTags() {
  const s = useData();
  const [m, setM] = useState(''); const [cat, setCat] = useState('c-groceries'); const [ren, setRen] = useState(''); const [err, setErr] = useState<string | null>(null);
  const [tag, setTag] = useState(''); const [terr, setTerr] = useState<string | null>(null);
  return (
    <>
      <TopBar title="Reglas y etiquetas" back="/settings" />
      <main>
        <section className="card" aria-label="Reglas">
          <div className="sechead"><span>Reglas</span></div>
          {s.rules.length === 0 ? <EmptyState title="Sin reglas" text="Una regla cambia categoría o nombre cuando el comerciante contiene un texto." /> : s.rules.map((r) => (
            <div key={r.id} className="row"><span className="grow"><span className="title">Si contiene «{r.merchantContains}»</span><span className="xs muted">{[r.renameTo ? `Renombrar a ${r.renameTo}` : '', r.setCategoryId ? `Categoría ${s.categories.find((c) => c.id === r.setCategoryId)?.name}` : ''].filter(Boolean).join(' · ')}</span></span><IconButton label={`Borrar regla ${r.merchantContains}`} onClick={() => removeRule(r.id)}><LuTrash2 /></IconButton></div>
          ))}
        </section>
        <section className="card pad form" aria-label="Nueva regla">
          <h2>Nueva regla</h2>
          <Field id="rm" label="El comerciante contiene" error={err}>{(p) => <input {...p} className="input" value={m} onChange={(e) => setM(e.target.value)} />}</Field>
          <Field id="rc" label="Poner la categoría">{() => <CategoryPicker s={s} value={cat} onChange={setCat} />}</Field>
          <Field id="rr" label="Renombrar a (opcional)">{(p) => <input {...p} className="input" value={ren} onChange={(e) => setRen(e.target.value)} />}</Field>
          <Button onClick={async () => { try { await addRule({ merchantContains: m, setCategoryId: cat, renameTo: ren.trim() || undefined }); setM(''); setRen(''); setErr(null); toast('Regla creada. Se aplica a las nuevas transacciones.'); } catch (x) { setErr(x instanceof ValidationError ? x.message : 'Error'); } }}>Crear regla</Button>
        </section>
        <section className="card" aria-label="Etiquetas">
          <div className="sechead"><span>Etiquetas</span></div>
          {s.tags.map((t) => <div key={t.id} className="row"><span className="grow">{t.name}</span><IconButton label={`Borrar etiqueta ${t.name}`} onClick={() => removeTag(t.id)}><LuTrash2 /></IconButton></div>)}
          <form className="row" onSubmit={async (e) => { e.preventDefault(); try { await addTag(tag); setTag(''); setTerr(null); } catch (x) { setTerr(x instanceof ValidationError ? x.message : 'Error'); } }}>
            <input className="input" aria-label="Nueva etiqueta" placeholder="Nueva etiqueta" value={tag} onChange={(e) => setTag(e.target.value)} aria-invalid={terr ? true : undefined} />
            <Button type="submit">Añadir</Button>
          </form>
          {terr ? <p className="err" role="alert" style={{ padding: '0 16px' }}>{terr}</p> : null}
        </section>
      </main>
    </>
  );
}

function DataScreen() {
  const s = useData();
  const file = useRef<HTMLInputElement>(null);
  const jfile = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<{ rows: ImportRow[]; bad: { line: number; reason: string }[]; error?: string } | null>(null);
  const [acc, setAcc] = useState(s.accounts.find((a) => a.group === 'cash' || a.group === 'credit')?.id ?? '');
  const [confirm, setConfirm] = useState<null | 'clear' | 'seed'>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const onCsv = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) return setCsv({ rows: [], bad: [], error: 'El archivo pesa más de 5 MB.' });
    let rows: string[][];
    try {
      if (/\.(xlsx|xls)$/i.test(f.name)) {
        const ab = await f.arrayBuffer();
        rows = isOLE(new Uint8Array(ab)) ? parseXLS(ab) : await parseXLSX(ab); // por contenido, no por extensión
      } else rows = parseCSV(await f.text());
    }
    catch (x) { return setCsv({ rows: [], bad: [], error: x instanceof Error ? x.message : 'No se ha podido leer el archivo.' }); }
    const head = findHeader(rows);
    if (!head) return setCsv({ rows: [], bad: [], error: 'No encuentro las columnas. Necesito una fila con fecha, concepto e importe (o débito y crédito).' });
    { const r = rowsFromCSV(rows, head.map, head.index); setCsv({ rows: r.ok, bad: r.bad }); }
  };
  const plan = csv && acc ? planImport(s, acc, csv.rows) : null;
  const download = (name: string, text: string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); void markBackup(); };
  return (
    <>
      <TopBar title="Datos y copia" back="/settings" />
      <main>
        {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
        <section className="card pad form" aria-label="Importar CSV">
          <h2>Importar desde CSV o Excel</h2>
          <p className="hint">Archivo .csv, .xls o .xlsx (se lee la primera hoja). Se busca la fila de encabezados aunque haya filas de titular o saldo encima: fecha, concepto e importe (o débito y crédito). Fechas día/mes/año, AAAA-MM-DD o fechas de Excel. Importar dos veces el mismo archivo no duplica nada.</p>
          <Field id="ia" label="Cuenta de destino">{(p) => <select {...p} className="input" value={acc} onChange={(e) => setAcc(e.target.value)}>{s.accounts.filter((a) => a.group !== 'investments').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}</Field>
          <input ref={file} type="file" accept=".csv,.xlsx,.xls,application/vnd.ms-excel,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr" aria-label="Elegir archivo CSV o Excel" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onCsv(f); }} />
          <Button variant="secondary" onClick={() => file.current?.click()} disabled={!acc}><LuUpload aria-hidden="true" size={18} />Elegir archivo</Button>
          {csv?.error ? <Banner tone="bad">{csv.error}</Banner> : null}
          {csv && !csv.error && plan ? (
            <>
              <Banner tone={plan.fresh.length ? 'info' : 'warn'}>{plan.fresh.length} nuevas, {plan.skipped} ya existían{csv.bad.length ? `, ${csv.bad.length} filas con problemas (${csv.bad.slice(0, 3).map((b) => `línea ${b.line}: ${b.reason}`).join('; ')}${csv.bad.length > 3 ? '…' : ''})` : ''}.</Banner>
              <Button disabled={!plan.fresh.length} onClick={async () => { const r = await importRows(acc, csv.rows); setCsv(null); setMsg({ tone: 'ok', text: `Importadas ${r.added} transacciones. Se han marcado por revisar.` }); }}>Importar {plan.fresh.length}</Button>
            </>
          ) : null}
        </section>
        <section className="card pad form" aria-label="Copia de seguridad">
          <h2>Copia de seguridad</h2>
          <p className="hint">Un archivo JSON con todos tus datos. Guárdalo fuera del teléfono. {s.settings.lastBackupAt ? `Última copia: ${new Date(s.settings.lastBackupAt).toLocaleDateString('es-ES')}.` : 'Aún no has descargado ninguna.'}</p>
          <Button variant="secondary" onClick={() => download(`aljibe-${todayISO()}.json`, exportJSON(), 'application/json')}><LuDownload aria-hidden="true" size={18} />Descargar copia</Button>
          <input ref={jfile} type="file" accept="application/json,.json" className="sr" aria-label="Elegir copia de seguridad" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await importJSON(await f.text()); setMsg({ tone: 'ok', text: 'Copia restaurada.' }); } catch (x) { setMsg({ tone: 'bad', text: x instanceof ValidationError ? x.message : 'No se ha podido restaurar.' }); } }} />
          <Button variant="secondary" onClick={() => jfile.current?.click()}><LuUpload aria-hidden="true" size={18} />Restaurar copia</Button>
          <p className="hint">Restaurar sustituye lo que tengas ahora.</p>
        </section>
        <section className="card pad form" aria-label="Datos de ejemplo">
          <h2>Datos de ejemplo</h2>
          <p className="hint">Los comercios, precios e índices son inventados.</p>
          <div className="btnrow"><Button variant="secondary" onClick={() => setConfirm('seed')}>Cargar ejemplo</Button><Button variant="danger" onClick={() => setConfirm('clear')}>Vaciar todo</Button></div>
        </section>
      </main>
      {confirm ? (
        <Sheet title={confirm === 'clear' ? '¿Vaciar todos los datos?' : '¿Cargar los datos de ejemplo?'} onClose={() => setConfirm(null)}>
          <p>{confirm === 'clear' ? 'Se borran cuentas, transacciones y presupuestos. Descarga una copia antes si quieres poder recuperarlos.' : 'Sustituye todo lo que tengas ahora por datos inventados.'}</p>
          <div className="btnrow"><Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button><Button variant="danger" onClick={async () => { if (confirm === 'clear') await clearAll(); else await resetSeed(); setConfirm(null); setMsg({ tone: 'ok', text: confirm === 'clear' ? 'Todo vaciado.' : 'Datos de ejemplo cargados.' }); }}>{confirm === 'clear' ? 'Vaciar' : 'Sustituir'}</Button></div>
        </Sheet>
      ) : null}
    </>
  );
}

function Display() {
  const s = useData();
  const widgets = widgetOrder(s.settings);
  const nav = navOrder(s.settings);
  const Mover = ({ kind, i, n, label }: { kind: 'widgets' | 'nav'; i: number; n: number; label: string }) => (
    <span style={{ display: 'flex' }}>
      <IconButton label={`Subir ${label}`} disabled={i === 0} onClick={() => moveItem(kind, i, -1)}><LuArrowUp /></IconButton>
      <IconButton label={`Bajar ${label}`} disabled={i === n - 1} onClick={() => moveItem(kind, i, 1)}><LuArrowDown /></IconButton>
    </span>
  );
  return (
    <>
      <TopBar title="Pantalla y tema" back="/settings" />
      <main>
        <section className="card pad form" aria-label="Tema">
          <h2>Tema</h2>
          <Segmented label="Tema" value={s.settings.theme} onChange={(v) => updateSettings({ theme: v })} options={[{ id: 'system', label: 'Sistema' }, { id: 'light', label: 'Claro' }, { id: 'dark', label: 'Oscuro' }]} />
        </section>
        <section className="card" aria-label="Widgets del inicio">
          <div className="sechead"><span>Inicio: qué ver y en qué orden</span></div>
          {widgets.map((w, i) => (
            <div key={w.id} className="row" style={{ minHeight: 56 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minHeight: 48, cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 22, height: 22 }} checked={w.visible} onChange={(e) => updateSettings({ dashboardWidgets: widgets.map((x) => (x.id === w.id ? { ...x, visible: e.target.checked } : x)) })} />
                <span>{WIDGET_NAMES[w.id]}</span>
              </label>
              <Mover kind="widgets" i={i} n={widgets.length} label={WIDGET_NAMES[w.id]} />
            </div>
          ))}
        </section>
        <section className="card" aria-label="Barra de navegación">
          <div className="sechead"><span>Barra inferior</span></div>
          <p className="hint" style={{ padding: '8px 16px 0', margin: 0 }}>Las {BAR_SLOTS} primeras van en la barra; las demás, en el menú.</p>
          {nav.map((id, i) => (
            <div key={id} className="row" style={{ minHeight: 56 }}>
              <span className="grow">{DESTS[id].label}</span>
              <span className="xs muted" style={{ marginRight: 4 }}>{i < BAR_SLOTS ? 'En la barra' : 'En el menú'}</span>
              <Mover kind="nav" i={i} n={nav.length} label={DESTS[id].label} />
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
