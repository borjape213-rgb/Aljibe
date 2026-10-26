/** Lector mínimo de .xlsx (primera hoja). Sin dependencias: un xlsx es un zip con XML. */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Entry { name: string; method: number; compSize: number; localOffset: number }

function readEntries(buf: Uint8Array): Entry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // fin del directorio central: firma 0x06054b50, dentro de los últimos 64 KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un .xlsx válido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('El archivo no es un .xlsx válido.');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    out.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)), method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readFile(buf: Uint8Array, e: Entry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nameLen = dv.getUint16(e.localOffset + 26, true), extraLen = dv.getUint16(e.localOffset + 28, true);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  const bytes = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null;
  if (!bytes) throw new Error('El .xlsx usa una compresión que no sé leer.');
  return new TextDecoder().decode(bytes);
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
const textOf = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

export function formatNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  // los importes salen con ruido de coma flotante (12.350000000000001): se redondea a 2 decimales
  // salvo fechas con hora (serie con parte decimal), que se dejan con 6 decimales
  return v > 20000 ? String(Math.round(v * 1e6) / 1e6) : (Math.round(v * 100) / 100).toFixed(2);
}

export async function parseXLSX(data: ArrayBuffer): Promise<string[][]> {
  const buf = new Uint8Array(data);
  const entries = readEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const shared: string[] = [];
  const ss = byName.get('xl/sharedStrings.xml');
  if (ss) for (const m of (await readFile(buf, ss)).matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  const sheetEntry = byName.get('xl/worksheets/sheet1.xml') ?? entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (!sheetEntry) throw new Error('No encuentro ninguna hoja en el archivo.');
  const xml = await readFile(buf, sheetEntry);
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = '';
      if (type === 's' && v !== undefined) val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = textOf(inner);
      else if (type === 'b') val = v === '1' ? 'sí' : 'no';
      else if (v !== undefined) { const n = Number(v); val = Number.isFinite(n) && type !== 'str' && type !== 'e' ? formatNumber(n) : unescapeXml(v); }
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push('');
      row[idx] = val;
    }
    if (row.some((x) => x.trim() !== '')) rows.push(row);
  }
  if (!rows.length) throw new Error('La primera hoja está vacía.');
  return rows;
}
