const MINUS = '−';

/** Formatea céntimos con la moneda dada. `signed` pone − o + explícito. */
export function formatCents(
  cents: number,
  currency: string,
  opts: { signed?: boolean; locale?: string } = {},
): string {
  const nf = new Intl.NumberFormat(opts.locale, { style: 'currency', currency, useGrouping: 'always' });
  const body = nf.format(Math.abs(cents) / 100);
  if (!opts.signed) return cents < 0 ? `${MINUS}${body}` : body;
  if (cents === 0) return body;
  return `${cents < 0 ? MINUS : '+'}${body}`;
}

/** Frase para lectores de pantalla: "menos 45,20 €". */
export function spokenCents(cents: number, currency: string, locale?: string): string {
  const body = formatCents(Math.abs(cents), currency, { locale });
  if (cents === 0) return body;
  return `${cents < 0 ? 'menos' : 'más'} ${body}`;
}

/**
 * Convierte texto escrito por una persona en céntimos enteros, o null si no es válido.
 * Con los dos separadores, el último es el decimal ("1.234,56" y "1,234.56").
 * Con uno solo: si se repite o va seguido de exactamente 3 cifras es de miles; si va
 * seguido de 1 o 2 cifras es decimal; en otro caso no es válido.
 */
export function parseCents(input: string): number | null {
  let s = input.trim().replace(/\s/g, '').replace(/−/g, '-');
  if (s === '') return null;
  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart = s;
  let frac = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    intPart = s.slice(0, dec).replace(/[.,]/g, '');
    frac = s.slice(dec + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const after = parts[parts.length - 1];
    if (parts.length > 2 || after.length === 3) {
      if (parts.slice(1).some((p) => p.length !== 3)) return null;
      intPart = parts.join('');
    } else if (after.length === 1 || after.length === 2) {
      intPart = parts.slice(0, -1).join('');
      frac = after;
    } else {
      return null;
    }
  }
  if (!/^[0-9]*$/.test(intPart) || !/^[0-9]{0,2}$/.test(frac)) return null;
  if (intPart === '' && frac === '') return null;
  const cents = Number(intPart || '0') * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return sign * cents;
}

const CUR = '(?:€|\\$|£|¥|eur(?:os?)?|usd|gbp|chf)';
const CUR_LEAD = new RegExp(`^${CUR}`, 'i');
const CUR_TRAIL = new RegExp(`${CUR}$`, 'i');

/**
 * Como `parseCents`, pero para importes tal como los escribe un banco en un extracto:
 * admite símbolo o código de moneda delante o detrás ("45,20 €", "EUR 45,20", "$ 12"),
 * negativo entre paréntesis ("(45,20)") y signo al final ("45,20-"). Devuelve null si el
 * texto no es un importe o si el signo es ambiguo ("(-45,20)", "-45,20-").
 */
export function parseAmount(input: string): number | null {
  let s = input.replace(/\s/g, '').replace(/−/g, '-');
  let minus = 0, plus = 0;
  for (let changed = true; changed && s !== ''; ) {
    changed = false;
    const lead = CUR_LEAD.exec(s);
    if (lead) { s = s.slice(lead[0].length); changed = true; }
    const trail = CUR_TRAIL.exec(s);
    if (trail && s.length > trail[0].length) { s = s.slice(0, -trail[0].length); changed = true; }
    if (s.length > 2 && s.startsWith('(') && s.endsWith(')')) { s = s.slice(1, -1); minus++; changed = true; }
    if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') minus++; else plus++; s = s.slice(1); changed = true; }
    if (s.length && (s.at(-1) === '-' || s.at(-1) === '+')) { if (s.at(-1) === '-') minus++; else plus++; s = s.slice(0, -1); changed = true; }
  }
  if (minus + plus > 1) return null;
  const v = parseCents(s);
  if (v === null) return null;
  return minus ? -Math.abs(v) : Math.abs(v);
}
