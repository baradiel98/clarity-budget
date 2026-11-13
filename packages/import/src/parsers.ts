import { parseCsv } from './csv';

/**
 * A statement parser turns file text into a table. CSV is implemented in Phase 1.
 * OFX/QFX, XLSX and PDF (and OCR for images) plug in here in later phases and feed the
 * same mapping → normalize → review pipeline.
 */
export interface RawTable {
  rows: string[][];
  delimiter: string;
}

export interface StatementParser {
  id: string;
  label: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  /** 0..1 confidence that this parser handles the file. */
  detect(fileName: string, text: string): number;
  parse(text: string): RawTable;
}

export const csvParser: StatementParser = {
  id: 'csv',
  label: 'CSV (comma-separated values)',
  extensions: ['.csv', '.txt', '.tsv'],
  mimeTypes: ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'text/tab-separated-values', 'application/csv'],
  detect(fileName, text) {
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    if (!this.extensions.includes(ext)) return 0;
    // eslint-disable-next-line no-control-regex -- ZIP (XLSX) magic bytes
    if (/^\s*(<\?xml|OFXHEADER|<OFX|%PDF|PK\u0003\u0004)/.test(text)) return 0;
    return 1;
  },
  parse(text) {
    const r = parseCsv(text);
    return { rows: r.rows, delimiter: r.delimiter };
  },
};

export const PARSERS: readonly StatementParser[] = [csvParser];

/** Formats recognized but not yet supported, so the UI can say so honestly. */
export const PLANNED_FORMATS = ['.ofx', '.qfx', '.xlsx', '.xls', '.pdf', '.png', '.jpg', '.jpeg', '.heic'] as const;

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20000;

export type FileCheck = { ok: true; parser: StatementParser } | { ok: false; reason: string };

/** Validate a file before parsing: size, extension, content sniffing (binary / other formats). */
export function checkImportFile(fileName: string, sizeBytes: number, head: string): FileCheck {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  if (sizeBytes > MAX_IMPORT_BYTES) return { ok: false, reason: 'This file is larger than 10 MB. Export a shorter date range from your bank.' };
  if (sizeBytes === 0) return { ok: false, reason: 'This file is empty.' };
  if ((PLANNED_FORMATS as readonly string[]).includes(ext)) {
    return { ok: false, reason: `${ext.slice(1).toUpperCase()} statements are not supported yet. Download a CSV export from your bank instead.` };
  }
  // Binary content (NUL bytes or many control characters) is rejected.
  // eslint-disable-next-line no-control-regex -- detecting binary content is the point
  const control = (head.match(/[\u0000-\u0008\u000e-\u001f]/g) ?? []).length;
  if (head.includes('\u0000') || control > head.length * 0.01) return { ok: false, reason: 'This does not look like a text CSV file.' };
  const parser = PARSERS.map((p) => ({ p, s: p.detect(fileName, head) })).sort((a, b) => b.s - a.s)[0];
  if (!parser || parser.s === 0) return { ok: false, reason: 'Only CSV statements can be imported right now.' };
  return { ok: true, parser: parser.p };
}
