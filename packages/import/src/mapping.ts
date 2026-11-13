import type { ColumnMapping, DateFormat, DecimalSeparator } from '@clarity/shared';
import { detectDateFormats, detectDecimalSeparator, looksLikeAmount, looksLikeDate } from './normalize';
import type { RawTable } from './parsers';

const H = {
  date: /^(transaction |trans\.? |posting |post(ed)? |value |booking )?date( posted)?$|^date$|^fecha( de operaci[oó]n)?$|^posted$/i,
  description: /description|details|memo|payee|merchant|narrative|^name$|particulars|concepto|descripci|transaction$/i,
  amount: /^(transaction )?amount( \(.*\))?$|^importe$|^monto$|^value$|^amt$/i,
  debit: /debit|withdrawal|money out|paid out|^out$|cargo|retiro|outflow|spent/i,
  credit: /credit|deposit|money in|paid in|^in$|abono|dep[oó]sito|inflow|received/i,
  balance: /balance|saldo|running/i,
  externalId: /^(transaction )?id$|reference|^ref|fitid|transaction number|confirmation/i,
};

export const headerSignature = (headers: readonly string[]): string => headers.map((h) => h.trim().toLowerCase()).join('|');

export interface MappingGuess {
  hasHeader: boolean;
  headers: string[];
  columns: ColumnMapping | null;
  dateFormats: DateFormat[];
  decimalSeparator: DecimalSeparator;
  problems: string[];
}

function isHeaderRow(row: readonly string[], next: readonly string[] | undefined): boolean {
  const keyword = row.some((c) => Object.values(H).some((re) => re.test(c.trim())));
  const numeric = row.filter((c) => looksLikeAmount(c) || looksLikeDate(c)).length;
  const nextNumeric = next ? next.filter((c) => looksLikeAmount(c) || looksLikeDate(c)).length : 0;
  return keyword || (numeric === 0 && nextNumeric > 0);
}

/** Skip leading preamble lines (account number, statement period) that many banks add. */
export function findTableStart(table: RawTable): number {
  const rows = table.rows;
  const width = (r: readonly string[]) => r.filter((c) => c !== '').length;
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  const mainWidth = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  for (let i = 0; i < rows.length; i++) if (rows[i]!.length === mainWidth && width(rows[i]!) >= 2) return i;
  return 0;
}

export function guessMapping(table: RawTable): MappingGuess {
  const problems: string[] = [];
  const start = findTableStart(table);
  const rows = table.rows.slice(start).filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) return { hasHeader: false, headers: [], columns: null, dateFormats: [], decimalSeparator: '.', problems: ['The file has no rows.'] };
  const hasHeader = isHeaderRow(rows[0]!, rows[1]);
  const headers = hasHeader ? rows[0]!.map((h) => h.trim()) : rows[0]!.map((_, i) => `Column ${i + 1}`);
  const body = (hasHeader ? rows.slice(1) : rows).slice(0, 200);
  const width = headers.length;
  const col = (i: number) => body.map((r) => r[i] ?? '');

  const find = (re: RegExp, exclude: number[] = []) =>
    hasHeader ? headers.findIndex((h, i) => !exclude.includes(i) && re.test(h)) : -1;

  let date = find(H.date);
  if (date < 0) date = [...Array(width).keys()].find((i) => col(i).filter(Boolean).every(looksLikeDate) && col(i).some(Boolean)) ?? -1;
  let amount = find(H.amount, [date]);
  const debit = find(H.debit, [date, amount]);
  const credit = find(H.credit, [date, amount, debit]);
  const balance = find(H.balance, [date, amount, debit, credit]);
  const externalId = find(H.externalId, [date, amount, debit, credit, balance]);
  let description = find(H.description, [date, amount, debit, credit, balance, externalId]);

  const used = () => [date, amount, debit, credit, balance, externalId, description];
  const numericCols = [...Array(width).keys()].filter((i) => !used().includes(i) && col(i).filter(Boolean).length > 0 && col(i).filter(Boolean).every(looksLikeAmount));
  if (amount < 0 && (debit < 0 || credit < 0) && numericCols.length > 0) amount = numericCols[0]!;
  if (description < 0) {
    // longest average text among non-numeric columns
    let best = -1;
    let bestLen = 0;
    for (let i = 0; i < width; i++) {
      if (used().includes(i)) continue;
      const vals = col(i).filter(Boolean);
      if (vals.every(looksLikeAmount)) continue;
      const avg = vals.reduce((s, v) => s + v.length, 0) / Math.max(1, vals.length);
      if (avg > bestLen) [best, bestLen] = [i, avg];
    }
    description = best;
  }

  if (date < 0) problems.push('Could not find a date column.');
  if (description < 0) problems.push('Could not find a description column.');
  if (amount < 0 && (debit < 0 || credit < 0)) problems.push('Could not find an amount column (or debit and credit columns).');

  const columns: ColumnMapping | null =
    date >= 0 && description >= 0 && (amount >= 0 || (debit >= 0 && credit >= 0))
      ? {
          date,
          description,
          ...(amount >= 0 && !(debit >= 0 && credit >= 0) ? { amount } : { debit, credit }),
          ...(balance >= 0 ? { balance } : {}),
          ...(externalId >= 0 ? { externalId } : {}),
        }
      : null;

  const amountVals = columns ? [columns.amount, columns.debit, columns.credit, columns.balance].filter((i): i is number => i !== undefined).flatMap(col) : [];
  return {
    hasHeader,
    headers,
    columns,
    dateFormats: date >= 0 ? detectDateFormats(col(date)) : [],
    decimalSeparator: detectDecimalSeparator(amountVals),
    problems,
  };
}

/** Data rows (after preamble and header), each with its 1-based line number in the file. */
export function dataRows(table: RawTable, hasHeader: boolean): { line: number; cells: string[] }[] {
  const start = findTableStart(table) + (hasHeader ? 1 : 0);
  const out: { line: number; cells: string[] }[] = [];
  for (let i = start; i < table.rows.length; i++) out.push({ line: i + 1, cells: table.rows[i]! });
  return out;
}
