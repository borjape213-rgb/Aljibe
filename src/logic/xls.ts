/** Lector mínimo de .xls antiguo (Excel 97-2003, BIFF8 dentro de un contenedor CFB). Primera hoja, solo valores. Sin dependencias. */
import { formatNumber } from './xlsx.ts';

const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
export const isOLE = (b: Uint8Array) => MAGIC.every((m, i) => b[i] === m);
const BAD = 'El archivo .xls no se puede leer (¿está protegido o dañado?). Guárdalo como .xlsx o .csv desde Excel.';

/** Extrae el flujo "Workbook" (o "Book") del contenedor CFB. */
function workbookStream(buf: Uint8Array): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ssz = 1 << dv.getUint16(30, true), mssz = 1 << dv.getUint16(32, true);
  const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true), cutoff = dv.getUint32(56, true);
  const miniStart = dv.getUint32(60, true), difStart = dv.getUint32(68, true), nDif = dv.getUint32(72, true);
  const sector = (n: number) => buf.subarray(512 + n * ssz, 512 + (n + 1) * ssz);
  const u32 = (a: Uint8Array) => new DataView(a.buffer, a.byteOffset, a.byteLength);
  // tabla de sectores (FAT)
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(dv.getUint32(76 + i * 4, true));
  let d = difStart;
  for (let i = 0; i < nDif && d < 0xfffffffa; i++) {
    const s = u32(sector(d));
    for (let j = 0; j < ssz / 4 - 1 && fatSectors.length < nFat; j++) fatSectors.push(s.getUint32(j * 4, true));
    d = s.getUint32(ssz - 4, true);
  }
  const fat: number[] = [];
  for (const fs of fatSectors) { const s = u32(sector(fs)); for (let j = 0; j < ssz / 4; j++) fat.push(s.getUint32(j * 4, true)); }
  const chain = (start: number): number[] => {
    const out: number[] = [];
    for (let n = start, guard = 0; n < 0xfffffffa && guard < fat.length + 1; n = fat[n], guard++) out.push(n);
    return out;
  };
  const read = (start: number, size?: number) => {
    const parts = chain(start).map(sector);
    const all = new Uint8Array(parts.length * ssz);
    parts.forEach((p, i) => all.set(p, i * ssz));
    return size === undefined ? all : all.subarray(0, size);
  };
  // directorio
  const dir = read(dirStart);
  const dd = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  let root: { start: number; size: number } | null = null;
  let found: { start: number; size: number } | null = null;
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = dd.getUint16(o + 64, true), type = dir[o + 66];
    let name = '';
    for (let k = 0; k < Math.max(0, nameLen - 2); k += 2) name += String.fromCharCode(dd.getUint16(o + k, true));
    const ent = { start: dd.getUint32(o + 116, true), size: dd.getUint32(o + 120, true) };
    if (type === 5) root = ent;
    if (type === 2 && (name === 'Workbook' || name === 'Book')) found = ent;
  }
  if (!found) throw new Error(BAD);
  if (found.size >= cutoff) return read(found.start, found.size);
  // flujos pequeños: viven en el "mini stream"
  if (!root) throw new Error(BAD);
  const mini = read(root.start);
  const miniFatBytes = read(miniStart);
  const mf = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const out = new Uint8Array(found.size);
  let pos = 0;
  for (let n = found.start, g = 0; n < 0xfffffffa && pos < found.size && g < 100000; n = mf.getUint32(n * 4, true), g++) {
    const piece = mini.subarray(n * mssz, (n + 1) * mssz);
    out.set(piece.subarray(0, Math.min(piece.length, found.size - pos)), pos);
    pos += mssz;
  }
  return out;
}

interface Rec { id: number; data: Uint8Array }

function records(wb: Uint8Array): Rec[] {
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const out: Rec[] = [];
  for (let p = 0; p + 4 <= wb.length; ) {
    const id = dv.getUint16(p, true), len = dv.getUint16(p + 2, true);
    out.push({ id, data: wb.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  return out;
}

/** Lector de la tabla de textos compartidos (SST), que puede partirse en registros CONTINUE. */
function readSST(chunks: Uint8Array[]): string[] {
  let ci = 0, pos = 0;
  const cur = () => chunks[ci];
  const need = () => { while (ci < chunks.length && pos >= chunks[ci].length) { ci++; pos = 0; } return ci < chunks.length; };
  const u8 = () => { if (!need()) throw new Error(BAD); return cur()[pos++]; };
  const u16 = () => u8() | (u8() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  u32(); // total de referencias
  const unique = u32();
  const out: string[] = [];
  for (let i = 0; i < unique; i++) {
    if (!need()) break;
    const nChars = u16();
    const flags = u8();
    let wide = (flags & 1) !== 0;
    const rich = (flags & 8) !== 0, ext = (flags & 4) !== 0;
    const runs = rich ? u16() : 0;
    const extLen = ext ? u32() : 0;
    let s = '';
    for (let k = 0; k < nChars; k++) {
      if (pos >= cur().length) { ci++; pos = 0; if (ci >= chunks.length) break; wide = (cur()[pos++] & 1) !== 0; } // el nuevo registro repite el byte de formato
      s += wide ? String.fromCharCode(cur()[pos] | (cur()[pos + 1] << 8)) : String.fromCharCode(cur()[pos]);
      pos += wide ? 2 : 1;
    }
    for (let k = 0; k < runs * 4 + extLen; k++) { if (!need()) break; pos++; }
    out.push(s);
  }
  return out;
}

function rkValue(rk: number): number {
  const div = (rk & 1) !== 0, int = (rk & 2) !== 0;
  let v: number;
  if (int) v = rk >> 2;
  else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, (rk & 0xfffffffc) >>> 0, true); v = b.getFloat64(0, true); }
  return div ? v / 100 : v;
}

export function parseXLS(data: ArrayBuffer): string[][] {
  const buf = new Uint8Array(data);
  if (!isOLE(buf)) throw new Error(BAD);
  const recs = records(workbookStream(buf));
  const sstChunks: Uint8Array[] = [];
  let shared: string[] = [];
  let bofs = 0, inSST = false;
  const cells = new Map<number, Map<number, string>>();
  const put = (r: number, c: number, v: string) => { let row = cells.get(r); if (!row) cells.set(r, (row = new Map())); row.set(c, v); };
  let lastFormula: [number, number] | null = null;
  for (const { id, data: d } of recs) {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (id === 0x809) { bofs++; inSST = false; if (bofs === 2 && sstChunks.length) shared = readSST(sstChunks); if (bofs > 2) break; continue; }
    if (bofs === 1) {
      if (id === 0xfc) { inSST = true; sstChunks.push(d); } else if (id === 0x3c && inSST) sstChunks.push(d); else inSST = false;
      continue;
    }
    if (bofs !== 2) continue;
    switch (id) {
      case 0xfd: put(dv.getUint16(0, true), dv.getUint16(2, true), shared[dv.getUint32(6, true)] ?? ''); break; // LABELSST
      case 0x203: put(dv.getUint16(0, true), dv.getUint16(2, true), formatNumber(dv.getFloat64(6, true))); break; // NUMBER
      case 0x27e: put(dv.getUint16(0, true), dv.getUint16(2, true), formatNumber(rkValue(dv.getUint32(6, true)))); break; // RK
      case 0xbd: { // MULRK
        const r = dv.getUint16(0, true), c0 = dv.getUint16(2, true), n = (d.length - 6) / 6;
        for (let i = 0; i < n; i++) put(r, c0 + i, formatNumber(rkValue(dv.getUint32(4 + i * 6 + 2, true))));
        break;
      }
      case 0x204: { // LABEL (texto antiguo)
        const n = dv.getUint16(6, true), wide = (d[8] & 1) !== 0;
        let s = ''; for (let k = 0; k < n; k++) s += wide ? String.fromCharCode(dv.getUint16(9 + k * 2, true)) : String.fromCharCode(d[9 + k]);
        put(dv.getUint16(0, true), dv.getUint16(2, true), s); break;
      }
      case 0x06: { // FORMULA: se toma el resultado guardado
        const r = dv.getUint16(0, true), c = dv.getUint16(2, true);
        if (d[6 + 6] === 0xff && d[6 + 7] === 0xff) lastFormula = [r, c]; // resultado de texto: viene en el registro STRING
        else { lastFormula = null; put(r, c, formatNumber(dv.getFloat64(6, true))); }
        break;
      }
      case 0x207: if (lastFormula) { const n = dv.getUint16(0, true), wide = (d[2] & 1) !== 0; let s = ''; for (let k = 0; k < n; k++) s += wide ? String.fromCharCode(dv.getUint16(3 + k * 2, true)) : String.fromCharCode(d[3 + k]); put(lastFormula[0], lastFormula[1], s); lastFormula = null; } break;
    }
  }
  const rows: string[][] = [];
  for (const r of [...cells.keys()].sort((a, b) => a - b)) {
    const row = cells.get(r)!;
    const width = Math.max(...row.keys()) + 1;
    const arr: string[] = [];
    for (let c = 0; c < width; c++) arr.push(row.get(c) ?? '');
    if (arr.some((x) => x.trim() !== '')) rows.push(arr);
  }
  if (!rows.length) throw new Error('La primera hoja está vacía.');
  return rows;
}
