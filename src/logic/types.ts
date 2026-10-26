export type Id = string;
export type AccountGroup = 'cash' | 'credit' | 'loans' | 'investments' | 'assets' | 'other';

export interface Account {
  id: Id;
  name: string;
  group: AccountGroup;
  /** Subtipo libre ("Cuenta corriente", "Hipoteca"…). */
  subtype: string;
  /** Saldo actual en céntimos. Pasivos en negativo. Para inversiones se ignora: manda el valor de las posiciones. */
  balanceCents: number;
  currency: string;
  hidden: boolean;
  /** ISO de la última actualización manual. */
  updatedAt: string;
  /** Para activos manuales: valoraciones puntuales (fecha → céntimos). */
  valuations?: { date: string; cents: number }[];
}

export interface CategoryGroup {
  id: Id;
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  /** Cubo del presupuesto flexible. */
  bucket: 'fixed' | 'nonmonthly' | 'flexible' | null;
}
export interface Category {
  id: Id;
  groupId: Id;
  name: string;
  icon: string;
}

export interface Split {
  categoryId: Id;
  amountCents: number;
  note?: string;
}
export interface Transaction {
  id: Id;
  accountId: Id;
  date: string; // YYYY-MM-DD
  amountCents: number; // gasto negativo
  merchant: string;
  categoryId: Id;
  notes: string;
  tags: Id[];
  pending: boolean;
  hidden: boolean;
  needsReview: boolean;
  splits: Split[];
  externalId?: string;
}
export interface Tag {
  id: Id;
  name: string;
}

export interface BudgetItem {
  categoryId: Id;
  month: string; // YYYY-MM-01
  amountCents: number;
}
export interface RolloverConfig {
  categoryId: Id;
  enabled: boolean;
  startMonth: string;
  startingBalanceCents: number;
}

export interface Rule {
  id: Id;
  /** Texto que debe contener el comerciante (sin distinguir mayúsculas). */
  merchantContains: string;
  setCategoryId?: Id;
  renameTo?: string;
}

export interface RecurringStream {
  id: Id;
  name: string;
  amountCents: number;
  frequency: 'weekly' | 'monthly' | 'yearly';
  dayOfMonth: number;
  /** Mes 1-12 solo para anuales. */
  month?: number;
  categoryId: Id;
  accountId: Id;
  status: 'active' | 'cancelled' | 'pending-approval';
}

export type AssetClass = 'equity' | 'bonds' | 'cash' | 'property' | 'crypto' | 'other';
export interface Security {
  id: Id;
  ticker: string;
  name: string;
  assetClass: AssetClass;
}
export interface PricePoint {
  date: string;
  price: number; // decimal, no céntimos
}
export interface Holding {
  id: Id;
  accountId: Id;
  securityId: Id;
  quantity: number;
  costBasisCents: number | null;
}
export interface Benchmark {
  id: Id;
  name: string;
  series: PricePoint[];
}

export interface Settings {
  currency: string;
  locale: string;
  theme: 'system' | 'light' | 'dark';
  navItems: string[];
  lastBackupAt?: string;
  createdAt?: string;
  dashboardWidgets: { id: string; visible: boolean }[];
}

export interface State {
  version: 1;
  settings: Settings;
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  tags: Tag[];
  transactions: Transaction[];
  budgetItems: BudgetItem[];
  rollovers: RolloverConfig[];
  rules: Rule[];
  recurring: RecurringStream[];
  securities: Security[];
  prices: Record<Id, PricePoint[]>;
  holdings: Holding[];
  benchmarks: Benchmark[];
  /** Fecha ISO de los datos de ejemplo; null si el usuario ya los ha vaciado. */
  seededAt: string | null;
}
