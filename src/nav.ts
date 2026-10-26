import { LuChartColumn, LuCreditCard, LuHouse, LuLayers, LuRepeat, LuTrendingUp, LuWallet } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import type { Settings } from './logic/types.ts';

export const DESTS: Record<string, { label: string; icon: IconType; path: string; roots: string[] }> = {
  dashboard: { label: 'Inicio', icon: LuHouse, path: '/', roots: [''] },
  accounts: { label: 'Cuentas', icon: LuLayers, path: '/accounts', roots: ['accounts', 'account'] },
  transactions: { label: 'Movimientos', icon: LuCreditCard, path: '/transactions', roots: ['transactions', 'transaction', 'review'] },
  cashflow: { label: 'Flujo', icon: LuChartColumn, path: '/cashflow', roots: ['cashflow'] },
  budget: { label: 'Presupuesto', icon: LuWallet, path: '/budget', roots: ['budget'] },
  recurring: { label: 'Recurrentes', icon: LuRepeat, path: '/recurring', roots: ['recurring'] },
  investments: { label: 'Inversiones', icon: LuTrendingUp, path: '/investments', roots: ['investments', 'holding'] },
};
export const DEFAULT_NAV = ['dashboard', 'accounts', 'transactions', 'cashflow', 'budget', 'recurring', 'investments'];
export const BAR_SLOTS = 5;

/** Orden guardado, sin ids desconocidos y con los que falten al final. */
export function navOrder(s: Pick<Settings, 'navItems'>): string[] {
  const known = s.navItems.filter((id) => id in DESTS);
  return [...new Set([...known, ...DEFAULT_NAV])];
}
export const WIDGET_NAMES: Record<string, string> = { networth: 'Patrimonio', budget: 'Presupuesto', recent: 'Transacciones', invest: 'Inversiones', recurring: 'Próximos pagos', monthreview: 'Revisión del mes' };
export function widgetOrder(s: Pick<Settings, 'dashboardWidgets'>) {
  const have = s.dashboardWidgets.filter((w) => w.id in WIDGET_NAMES);
  const missing = Object.keys(WIDGET_NAMES).filter((id) => !have.some((w) => w.id === id)).map((id) => ({ id, visible: true }));
  return [...have, ...missing];
}
