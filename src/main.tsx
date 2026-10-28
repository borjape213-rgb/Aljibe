import { createRoot } from 'react-dom/client';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { LuBell, LuChartColumn, LuCreditCard, LuHouse, LuLayers, LuMenu, LuWallet, LuRepeat, LuTrendingUp, LuSettings, LuTag, LuSlidersHorizontal, LuDownload, LuListFilter, LuCheck, LuX, LuMoon } from 'react-icons/lu';
import { continueWithoutSaving, getLock, init, useData, usePersistError, type StorageLock } from './store.ts';
import { go, useRoute } from './router.tsx';
import { Banner, IconButton, Skeleton, ToastHost } from './ui.tsx';
import { Dashboard } from './screens/dashboard.tsx';
import { Accounts, AccountDetail } from './screens/accounts.tsx';
import { Transactions, TransactionDetail, SplitScreen, Review } from './screens/transactions.tsx';
import { CashFlow } from './screens/cashflow.tsx';
import { Budget } from './screens/budget.tsx';
import { Recurring } from './screens/recurring.tsx';
import { Investments, HoldingDetail } from './screens/investments.tsx';
import { Settings } from './screens/settings.tsx';
import { TopBar } from './screens/shell.tsx';
import { needsCategory } from './logic/review.ts';
import { MonthReview } from './screens/monthreview.tsx';
import { LockScreen } from './screens/lock.tsx';
import { BAR_SLOTS, DESTS, navOrder } from './nav.ts';

function activeNav(p: string[]) {
  const h = p[0] ?? '';
  return Object.entries(DESTS).find(([, d]) => d.roots.includes(h))?.[0] ?? '';
}

function Screen() {
  const r = useRoute();
  const [h, a] = r.path;
  switch (h ?? '') {
    case '': return <Dashboard />;
    case 'accounts': return <Accounts route={r} />;
    case 'account': return <AccountDetail id={a} route={r} />;
    case 'transactions': return <Transactions route={r} />;
    case 'transaction': return r.path[2] === 'split' ? <SplitScreen id={a} /> : <TransactionDetail id={a} />;
    case 'review': return <Review />;
    case 'month-review': return <MonthReview route={r} />;
    case 'cashflow': return <CashFlow route={r} />;
    case 'budget': return <Budget route={r} />;
    case 'recurring': return <Recurring />;
    case 'investments': return <Investments route={r} />;
    case 'holding': return <HoldingDetail id={a} />;
    case 'settings': return <Settings route={r} />;
    default: return <><TopBar title="No encontrada" back="/" /><main><Banner tone="warn">Esa pantalla no existe. <a href="#/">Volver al inicio</a></Banner></main></>;
  }
}

function App() {
  const s = useData();
  const r = useRoute();
  const perr = usePersistError();
  useEffect(() => {
    const t = s.settings.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  }, [s.settings.theme]);
  const active = activeNav(r.path);
  const pendingReview = s.transactions.filter(needsCategory).length;
  return (
    <div className="app">
      {perr ? <div style={{ padding: '8px 16px' }}><Banner tone="warn">{perr}</Banner></div> : null}
      <Boundary key={r.path.join('/')}><Screen /></Boundary>
      <nav className="bottomnav" aria-label="Principal">
        {navOrder(s.settings).slice(0, BAR_SLOTS).map((id) => ({ id, ...DESTS[id] })).map((n) => (
          <a key={n.id} href={`#${n.path}`} aria-current={active === n.id ? 'page' : undefined} aria-label={n.id === 'transactions' && pendingReview ? `${n.label}, ${pendingReview} sin categoría` : n.label}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <n.icon aria-hidden="true" />
              {n.id === 'transactions' && pendingReview ? <span className="badge" style={{ top: -6, right: -12 }} aria-hidden="true">{pendingReview > 99 ? '99+' : pendingReview}</span> : null}
            </span>
            {n.label}
          </a>
        ))}
      </nav>
      <ToastHost />
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: String(e) }; }
  render() {
    if (this.state.error) return <div className="app"><main><Banner tone="bad">Algo ha fallado en esta pantalla: {this.state.error}</Banner><a className="btn" href="#/" onClick={() => this.setState({ error: null })}>Volver al inicio</a></main></div>;
    return this.props.children;
  }
}

function Boot() {
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lock, setLock] = useState<StorageLock | null>(null);
  useEffect(() => { init().then(() => { setLock(getLock()); setReady(true); }).catch((e) => setErr(String(e))); }, []);
  useEffect(() => { if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {}); }, []);
  if (err) return <div className="app"><main><Banner tone="bad">No se han podido cargar los datos: {err}</Banner></main></div>;
  if (!ready) return <div className="app"><main><Skeleton h={24} w="50%" /><Skeleton h={160} /><Skeleton h={96} /></main></div>;
  if (lock) return <LockScreen lock={lock} onContinue={() => { continueWithoutSaving(); setLock(null); }} />;
  return <App />;
}
createRoot(document.getElementById('root')!).render(<Boot />);
void [LuBell, LuMenu, LuRepeat, LuTrendingUp, LuSettings, LuTag, LuSlidersHorizontal, LuDownload, LuListFilter, LuCheck, LuX, LuMoon, IconButton, go];
