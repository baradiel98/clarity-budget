/** RFC 4180 CSV parsing with delimiter detection. No dependencies. */

export interface CsvResult {
  rows: string[][];
  delimiter: string;
}

const CANDIDATES = [',', ';', '\t', '|'];

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Pick the delimiter that splits the first lines into the most consistent column count (>1). */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => splitLine(l, d).length);
    if (counts.length === 0) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = 0;
    let consistent = 0;
    for (const [c, f] of freq) if (f > consistent || (f === consistent && c > mode)) [mode, consistent] = [c, f];
    if (mode < 2) continue;
    const score = consistent * 100 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  return parseCsv(line, d).rows[0] ?? [];
}

export function parseCsv(input: string, delimiter?: string): CsvResult {
  const text = stripBom(input);
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
      i++;
      continue;
    }
    if (c === d) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.map((r) => r.map((f) => f.trim())), delimiter: d };
}
