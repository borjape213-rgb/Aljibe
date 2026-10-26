/** Fechas como texto ISO local (YYYY-MM-DD). Nada de zonas horarias: el día es el día. */
export const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function todayISO(now = new Date()): string {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
export function parse(d: string): { y: number; m: number; d: number } {
  const [y, m, dd] = d.split('-').map(Number);
  return { y, m, d: dd };
}
export function addDays(d: string, n: number): string {
  const { y, m, d: dd } = parse(d);
  const dt = new Date(Date.UTC(y, m - 1, dd + n));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function daysBetween(a: string, b: string): number {
  const pa = parse(a), pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export function addMonths(month: string, n: number): string {
  const { y, m } = parse(month);
  const idx = y * 12 + (m - 1) + n;
  return iso(Math.floor(idx / 12), (idx % 12) + 1, 1);
}
export function daysInMonth(month: string): number {
  const { y, m } = parse(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** Lunes = 0 … domingo = 6. */
export function weekdayMon0(d: string): number {
  const { y, m, d: dd } = parse(d);
  return (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7;
}
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}
export function formatMonth(month: string, locale = 'es-ES'): string {
  const { y, m } = parse(month);
  const s = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function formatDay(d: string, locale = 'es-ES', opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string {
  const { y, m, d: dd } = parse(d);
  const s = new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const formatShort = (d: string, locale = 'es-ES') => formatDay(d, locale, { day: 'numeric', month: 'short' });
