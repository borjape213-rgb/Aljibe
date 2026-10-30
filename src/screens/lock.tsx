import { useMemo as _unused } from "react";
import { LuDownload, LuRefreshCw } from 'react-icons/lu';
import type { StorageLock } from '../store.ts';
import { Banner, Button } from '../ui.tsx';
import { todayISO } from '../logic/dates.ts';

/**
 * Pantalla de arranque cuando no se pueden cargar los datos guardados. No escribe nada en disco:
 * lo guardado puede ser lo único que tiene el usuario.
 */
export function LockScreen({ lock, onContinue }: { lock: StorageLock; onContinue: () => void }) {
  const unreadable = lock.reason === 'unreadable';
  const download = () => {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(lock.raw)], { type: 'application/json' }));
      a.download = `aljibe-guardado-${todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch { /* si ni siquiera se puede serializar, el botón no aporta más */ }
  };
  return (
    <div className="app">
      <main>
        <h1 style={{ margin: '16px 0 0' }}>{unreadable ? 'Tus datos guardados no se pueden abrir con esta versión' : 'No he podido leer tus datos guardados'}</h1>
        <Banner tone="warn">{unreadable
          ? 'Pueden venir de una versión más nueva de Aljibe o estar dañados. No he cambiado nada. Descarga lo guardado para conservarlo antes de hacer nada más.'
          : 'No he borrado ni cambiado nada, y no escribiré nada hasta poder leerlos. Prueba a reintentar; si sigue igual, cierra otras pestañas de Aljibe o reinicia el navegador.'}</Banner>
        <p className="xs muted">Detalle técnico: {lock.detail}</p>
        <div className="btnrow" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <Button onClick={() => location.reload()}><LuRefreshCw aria-hidden="true" size={18} />Reintentar</Button>
          {lock.raw !== null ? <Button variant="secondary" onClick={download}><LuDownload aria-hidden="true" size={18} />Descargar lo guardado</Button> : null}
          <Button variant="ghost" onClick={onContinue}>Continuar sin guardar</Button>
        </div>
        <p className="hint">«Continuar sin guardar» abre Aljibe vacío para esta sesión; no se escribe nada en disco y lo guardado queda intacto.</p>
      </main>
    </div>
  );
}
