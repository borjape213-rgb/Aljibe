import type { Category, Id, State, Transaction } from './types.ts';

/** Quita tildes y pasa a minúsculas con espacios simples. */
const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export type Kind = 'bizum-in' | 'bizum-out' | 'transfer-in' | 'transfer-out' | 'cash' | 'other';

export interface Parsed {
  kind: Kind;
  /** Nombre estable del comercio u orden: sin números de tarjeta, códigos, ciudades ni prefijos del banco. */
  key: string;
  /** Persona o empresa de un bizum o transferencia. */
  party: string;
  /** Texto libre del concepto, si lo hay. */
  concept: string;
}

const PREFIXES = [
  /^devolucion compra internet en /, /^devolucion compra en /, /^devolucion compra /, /^devolucion /,
  /^compra internet en /, /^compra en /, /^compra bizum /, /^compra /,
  /^pago movil en /, /^transaccion contactless en /, /^pago con tarjeta en /, /^recibo /,
];
const LEGAL = /\b(s a r l|s c a|s l u|s a u|s l|s a|et cie|slu|sau|sl|sa)\b/g;

function splitConcept(t: string): { head: string; concept: string } {
  const m = /\s+concepto:?\s*(.*)$/.exec(t);
  return m ? { head: t.slice(0, m.index), concept: m[1] } : { head: t, concept: '' };
}

/** Descompone el texto que pone el banco en tipo, nombre estable, parte implicada y concepto. */
export function parseMerchant(raw: string): Parsed {
  let t = plain(raw).replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, ' ');
  let kind: Kind = 'other';
  const people: [RegExp, Kind][] = [
    [/^bizum de /, 'bizum-in'], [/^bizum a favor de /, 'bizum-out'],
    [/^transferencia (inmediata )?a favor de /, 'transfer-out'], [/^transferencia (inmediata )?de /, 'transfer-in'],
  ];
  for (const [re, k] of people) {
    if (re.test(t)) {
      kind = k;
      const { head, concept } = splitConcept(t.replace(re, ''));
      const party = head.replace(/[.,;:]+$/, '').trim();
      return { kind, key: `${k}:${party}`, party, concept: concept.replace(/^[.,;:\s]+|[.,;:\s]+$/g, '') };
    }
  }
  if (/^retirada de efectivo/.test(t)) return { kind: 'cash', key: 'efectivo', party: '', concept: '' };
  for (const re of PREFIXES) if (re.test(t)) { t = t.replace(re, ''); break; }
  t = t.split(',')[0];
  t = t.replace(/\s+n[º°o]\.?\s*recibo.*$/, '').replace(/\s+(tarjeta|tarj\.?|comision)\b.*$/, '');
  t = t.replace(/^www\s*\./, '').replace(/\*(?=[a-z0-9]*\d)[a-z0-9]+/g, ' ').replace(/\*/g, ' ');
  t = t.replace(/[().;:]/g, ' ').replace(LEGAL, ' ');
  t = t.replace(/\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{6,}\b/g, ' ').replace(/\b\d{4,}\b/g, ' ');
  t = t.replace(/[^a-z0-9&+' -]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.startsWith('paypal')) t = 'paypal';
  return { kind, key: t || plain(raw).slice(0, 30), party: '', concept: '' };
}

/** Clave para agrupar cobros del mismo comercio aunque el texto del banco cambie. */
export const merchantKey = (raw: string) => parseMerchant(raw).key;

/** "spotify" → "Spotify"; para las personas quita el prefijo de tipo. */
export function prettyName(key: string): string {
  const base = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
  return base.replace(/(^|[\s-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

/* ---------- Categorías ---------- */

interface Spec { id: Id; name: string; groupId: Id }
const SPEC = {
  salary: { id: 'c-salary', name: 'Nómina', groupId: 'g-income' },
  otherinc: { id: 'c-otherinc', name: 'Otros ingresos', groupId: 'g-income' },
  rent: { id: 'c-rent', name: 'Alquiler', groupId: 'g-home' },
  utilities: { id: 'c-utilities', name: 'Luz y agua', groupId: 'g-home' },
  internet: { id: 'c-internet', name: 'Internet y móvil', groupId: 'g-bills' },
  subs: { id: 'c-subs', name: 'Suscripciones', groupId: 'g-bills' },
  groceries: { id: 'c-groceries', name: 'Supermercado', groupId: 'g-food' },
  eating: { id: 'c-eating', name: 'Restaurantes y café', groupId: 'g-food' },
  fuel: { id: 'c-fuel', name: 'Combustible', groupId: 'g-move' },
  transit: { id: 'c-transit', name: 'Transporte público', groupId: 'g-move' },
  car: { id: 'c-car', name: 'Coche y aparcamiento', groupId: 'g-move' },
  fun: { id: 'c-fun', name: 'Ocio', groupId: 'g-life' },
  shopping: { id: 'c-shopping', name: 'Compras', groupId: 'g-life' },
  travel: { id: 'c-travel', name: 'Viajes y alojamiento', groupId: 'g-life' },
  gym: { id: 'c-gym', name: 'Deporte y gimnasio', groupId: 'g-life' },
  edu: { id: 'c-edu', name: 'Formación', groupId: 'g-life' },
  care: { id: 'c-care', name: 'Cuidado personal', groupId: 'g-life' },
  cash: { id: 'c-cash', name: 'Efectivo', groupId: 'g-life' },
  pharmacy: { id: 'c-pharmacy', name: 'Farmacia y salud', groupId: 'g-health' },
  insurance: { id: 'c-insurance', name: 'Seguros', groupId: 'g-yearly' },
  taxes: { id: 'c-taxes', name: 'Impuestos y tasas', groupId: 'g-yearly' },
  transfer: { id: 'c-transfer', name: 'Traspaso', groupId: 'g-transfer' },
} satisfies Record<string, Spec>;
type SpecKey = keyof typeof SPEC;

/** Orden importa: lo más concreto primero (amazon prime antes que amazon). */
const DICTIONARY: [RegExp, SpecKey][] = [
  [/\b(nomina|salario|payroll)\b/, 'salary'],
  [/\b(traspaso propio|traspaso|retirada inversion|mintos|degiro|trade republic|myinvestor|indexa|interactive brokers|bitstamp|coinbase|binance|kraken)\b/, 'transfer'],
  [/\b(reintegro|cajero|disposicion)\b/, 'cash'],
  [/\b(spotify|netflix|hbo|disney|prime video|primevideo|amazon prime|youtube|icloud|apple com bill|google one|google youtube|dropbox|openai|chatgpt|anthropic|claude ai|patreon|twitch|crunchyroll|filmin|dazn|audible|adobe|microsoft 365|notion|github)\b/, 'subs'],
  [/\b(simyo|movistar|vodafone|orange|masorange|mas orange|masmovil|yoigo|digi|pepephone|jazztel|lowi|o2|finetwork|lycamobile|adamo)\b|\btelefon\w*/, 'internet'],
  [/\balquiler(?! de (coche|vehiculo|moto|furgoneta|bici|apartamento turistico))\b|\b(hipoteca|cuota hipoteca|comunidad de propietarios|comunidad propietarios|comunidad de vecinos|cdad propietarios)\b/, 'rent'],
  [/\b(iberdrola|endesa|naturgy|holaluz|emasa|emasesa|aguas|agua|gas natural|gas|viesgo|som energia|octopus|totalenergies|repsol luz|canal isabel|luz)\b/, 'utilities'],
  [/\b(mercadona|lidl|carrefour|dia|aldi|alcampo|eroski|supercor|hipercor|consum|coviran|ahorramas|supermercado|supersol|el arbol|hsn|gadis|condis|caprabo|bonpreu|froiz|mas y mas|family cash|fruteria|pescaderia|autoservicio|ultramarinos)\b|\bcarnicer\w*/, 'groceries'],
  [/\b(repsol|cepsa|moeve|texaco|shell|bp|galp|petroprix|gasolinera|eess|e s|estacion de servicio|petronor|ballenoil|plenergy|avia)\b|\bgasolin\w*/, 'fuel'],
  [/\b(feu vert|taller|autoescuela|neumaticos|itv|aparcamiento|parking|parkinglibre|easypark|peaje|autolavado|midas|norauto|recambios)\b/, 'car'],
  [/\b(renfe|metro|metro de sevilla|tussam|emt|taxi|uber|cabify|bolt|alsa|avanza|ouigo|iryo|blablacar|autobuses|autobus|bus|consorcio)\b/, 'transit'],
  [/\b(booking|airbnb|ryanair|vueling|easyjet|iberia express|iberia airlines|hotel|hostal|apartamentos|trainline|trivago|despegar|volotea|buceo|diving|dive)\b/, 'travel'],
  [/\b(gym|gimnasio|fitness|upgyms|basic fit|crossfit|padel|piscina|polideportivo)\b/, 'gym'],
  [/\b(academia|universidad|curso|colegio|formacion|udemy|coursera|flight training|fp espana|altiance|escuela|libreria)\b/, 'edu'],
  [/\bfarmac\w*|\bmedic\w*|\b(parafarmacia|clinica|dental|dentix|dentista|optica|hospital|sanitas|adeslas|asisa|fisio|fisioterapia|podologo|psicologo)\b/, 'pharmacy'],
  [/\b(poliza|seguro|seguros|mapfre|mutua|axa|linea directa|allianz|generali|reale|ocaso|pelayo)\b/, 'insurance'],
  [/\b(tributos|agencia tributaria|hacienda|aeat|ayuntamiento|ibi|impuesto|tasa|tasas|dgt|lipasam|suma|seguridad social)\b/, 'taxes'],
  [/\b(peluqueria|peluqueros|peluquero|barberia|barber|estetica|manicura|spa|masaje)\b/, 'care'],
  [/\b(cine|cinesur|cinesa|yelmo|kinepolis|ocine|cinema|teatro|entrada|entradas|ticket|tickets|ticketmaster|steam|playstation|nintendo|instant gaming|gamivo|eneba|xbox|epic games|discoteca|concierto|museo|bolera|escape room|feria)\b/, 'fun'],
  [/\b(amazon|aliexpress|zara|ikea|el corte ingles|pull bear|pull and bear|bershka|decathlon|primark|mediamarkt|pccomponentes|leroy merlin|bricomart|ferreteria|shein|temu|calzedonia|h m|mango|fnac|worten|zalando|bazar|tienda|estanco|casa del libro|ebay|wallapop)\b/, 'shopping'],
  [/\brestaur\w*|\bpizz\w*|\b(bar|cafe|cafeteria|telepizza|burger|burguer|mc ?donald'?s?|kfc|hamburgueseria|heladeria|taberna|asador|arroceria|tapas|tapeo|panaderia|pasteleria|sushi|kebab|foster'?s hollywood|vips|glovo|just eat|uber eats|vending|vendin|kiosko|bocadillo|cerveceria|chiringuito|desayuno|almuerzo|cena|comida|cerveza|copas|menu|tostada|brasa|gourmet|beach)\b/, 'eating'],
];

const SELF_WORDS = new Set(['de', 'la', 'del', 'los', 'las', 'y', 'el']);
/** ¿Aparecen todas las palabras del titular en el texto? ("Pérez de la Iglesia Borja" = "Borja Pérez de la Iglesia"). */
export function isHolder(text: string, holder: string | undefined): boolean {
  if (!holder) return false;
  const words = plain(holder).split(/[^a-z]+/).filter((w) => w.length > 2 && !SELF_WORDS.has(w));
  if (words.length < 2) return false;
  const have = new Set(plain(text).split(/[^a-z]+/));
  return words.every((w) => have.has(w));
}

function byDictionary(text: string): SpecKey | null {
  for (const [re, k] of DICTIONARY) if (re.test(text)) return k;
  return null;
}

/** Categoría que sugiere el diccionario para un comercio, o null si no lo conoce. */
export function dictionaryCategory(raw: string, amountCents: number, holder?: string): SpecKey | null {
  const p = parseMerchant(raw);
  if (p.kind === 'cash') return 'cash';
  if (p.kind === 'bizum-in' || p.kind === 'bizum-out') {
    const k = byDictionary(p.concept);
    return k ?? (p.kind === 'bizum-in' ? 'otherinc' : null);
  }
  if (p.kind === 'transfer-in' || p.kind === 'transfer-out') {
    if (isHolder(raw, holder)) return 'transfer';
    const k = byDictionary(`${p.party} ${p.concept}`);
    return k ?? (p.kind === 'transfer-in' && amountCents > 0 ? 'otherinc' : null);
  }
  return byDictionary(p.key);
}

export interface CatInput { id: Id; merchant: string; amountCents: number }

/**
 * Sugiere categoría para cada movimiento: primero lo último que has categorizado tú con el mismo comercio,
 * después el diccionario de comercios. Devuelve las asignaciones y las categorías nuevas que haría falta crear.
 */
export function suggestCategories(s: State, items: CatInput[], holder: string | undefined = s.settings.holder): { byId: Map<Id, Id>; created: Category[] } {
  const existing = new Set(s.categories.map((c) => c.id));
  // Lo que has elegido tú manda: para cada comercio (y signo), la categoría de su movimiento más reciente.
  const learned = new Map<string, { date: string; cat: Id }>();
  for (const t of s.transactions) {
    if (t.categoryId === 'c-none' || !existing.has(t.categoryId)) continue;
    const k = `${Math.sign(t.amountCents)}|${merchantKey(t.merchant)}`;
    const cur = learned.get(k);
    if (!cur || t.date > cur.date) learned.set(k, { date: t.date, cat: t.categoryId });
  }
  const created = new Map<Id, Category>();
  const resolve = (key: SpecKey): Id => {
    const spec = SPEC[key];
    if (existing.has(spec.id)) return spec.id;
    const byName = s.categories.find((c) => plain(c.name) === plain(spec.name));
    if (byName) return byName.id;
    if (!created.has(spec.id)) created.set(spec.id, { id: spec.id, groupId: s.groups.some((g) => g.id === spec.groupId) ? spec.groupId : (s.groups.find((g) => g.kind === 'expense')?.id ?? spec.groupId), name: spec.name, icon: 'tag' });
    return spec.id;
  };
  const byId = new Map<Id, Id>();
  for (const it of items) {
    const mine = learned.get(`${Math.sign(it.amountCents)}|${merchantKey(it.merchant)}`);
    if (mine) { byId.set(it.id, mine.cat); continue; }
    const k = dictionaryCategory(it.merchant, it.amountCents, holder);
    if (k) byId.set(it.id, resolve(k));
  }
  return { byId, created: [...created.values()] };
}

/** Movimientos "Sin categoría" (visibles, sin dividir) del mismo comercio y signo que los de `ids` que ahora están sin categoría. No incluye los propios `ids`. */
export function sameMerchantUncategorized(txs: Transaction[], ids: Id[]): Id[] {
  const set = new Set(ids);
  const keyOf = (t: Transaction) => `${Math.sign(t.amountCents)}|${merchantKey(t.merchant)}`;
  const keys = new Set(txs.filter((t) => set.has(t.id) && t.categoryId === 'c-none').map(keyOf));
  if (!keys.size) return [];
  return txs.filter((t) => !set.has(t.id) && t.categoryId === 'c-none' && !t.hidden && !t.splits.length && keys.has(keyOf(t))).map((t) => t.id);
}
