import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Account, ImportBatch, Transaction } from '@clarity/shared';
import {
  buildPreview, checkImportFile, csvParser, detectDateFormats, guessMapping, parseCsv, parseStatementAmount, reconcilePreview,
  suggestSignConvention, type ImportSettings, type PreviewContext,
} from '../src';

const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const T = 1_700_000_000_000;
const acct = (p: Partial<Account> = {}): Account => ({
  id: 'chk', name: 'Checking', type: 'checking', currency: 'USD', openingBalanceCents: 120000, openingDate: '2026-09-03',
  spendable: true, archived: false, createdAt: T, updatedAt: T, ...p,
});
const ctx = (p: Partial<PreviewContext> = {}): PreviewContext => ({
  account: acct(), accounts: [acct()], transactions: [], recurring: [], exceptions: [], importBatches: [], fileHash: 'h1', today: '2026-09-13', ...p,
});

function auto(name: string, account = acct()): { settings: ImportSettings; table: ReturnType<typeof csvParser.parse> } {
  const table = csvParser.parse(fx(name));
  const g = guessMapping(table);
  expect(g.columns).not.toBeNull();
  const base = { hasHeader: g.hasHeader, columns: g.columns!, dateFormat: g.dateFormats[0]!, decimalSeparator: g.decimalSeparator };
  const sign = suggestSignConvention(table, base, account);
  return { settings: { ...base, signConvention: sign.convention }, table };
}

describe('CSV parsing', () => {
  it('handles quotes, escaped quotes, CRLF and BOM', () => {
    const r = parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\r\n');
    expect(r.rows).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  });
  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b;c\n1;2;3').delimiter).toBe(';');
    expect(parseCsv('a\tb\tc\n1\t2\t3').delimiter).toBe('\t');
  });
});

describe('amount parsing', () => {
  it.each([
    ['-12.30', '.', -1230], ['(12.30)', '.', -1230], ['12.30-', '.', -1230], ['45.00 DR', '.', -4500], ['250.00 CR', '.', 25000],
    ['$1,234.56', '.', 123456], ['1.234,56', ',', 123456], ['-1.100,00', ',', -110000], ['−12.30', '.', -1230], ['USD 7', '.', 700],
    ['1 234,50', ',', 123450], ['12.345', '.', null], ['abc', '.', null], ['', '.', null],
  ] as const)('%s → %s', (text, dec, expected) => {
    expect(parseStatementAmount(text, dec)).toBe(expected);
  });
});

describe('date formats', () => {
  it('flags MM/DD vs DD/MM ambiguity instead of guessing', () => {
    const f = detectDateFormats(['03/09/2026', '05/09/2026', '10/09/2026']);
    expect(f).toEqual(expect.arrayContaining(['MM/DD/YYYY', 'DD/MM/YYYY']));
  });
  it('resolves when a day is > 12', () => {
    expect(detectDateFormats(['09/12/2026', '09/13/2026'])).toEqual(['MM/DD/YYYY']);
  });
});

describe('file checks', () => {
  it('rejects unsupported, empty, oversized and binary files', () => {
    expect(checkImportFile('s.pdf', 100, '%PDF-1.7')).toMatchObject({ ok: false });
    expect(checkImportFile('s.ofx', 100, 'OFXHEADER')).toMatchObject({ ok: false, reason: expect.stringMatching(/not supported yet/) });
    expect(checkImportFile('s.csv', 0, '')).toMatchObject({ ok: false });
    expect(checkImportFile('s.csv', 11 * 1024 * 1024, 'a,b')).toMatchObject({ ok: false });
    expect(checkImportFile('s.csv', 10, 'a\u0000b')).toMatchObject({ ok: false });
    expect(checkImportFile('s.csv', 10, 'a,b\n1,2')).toMatchObject({ ok: true });
  });
});

describe('signed amounts, newest first', () => {
  const { table, settings } = auto('signed-newest-first.csv');
  const p = buildPreview(table, settings, ctx());
  it('maps columns and keeps signs', () => {
    expect(settings.columns).toMatchObject({ date: 0, description: 1, amount: 2, balance: 3 });
    expect(settings.signConvention).toBe('as_is');
    expect(p.errors).toEqual([]);
    expect(p.candidates).toHaveLength(7);
    expect(p.runningBalanceConsistent).toBe(true);
  });
  it('classifies income, refunds and categories deterministically', () => {
    const by = (d: string) => p.candidates.find((c) => c.rawDescription.startsWith(d))!;
    expect(by('PAYROLL')).toMatchObject({ kind: 'income', categoryId: 'cat_paycheck', amountCents: 180000 });
    expect(by('AMAZON REFUND')).toMatchObject({ kind: 'refund', categoryId: 'cat_shopping' });
    expect(by("TRADER JOE'S")).toMatchObject({ kind: 'expense', categoryId: 'cat_groceries', merchant: "Trader Joe's" });
    expect(by('CITY POWER')).toMatchObject({ categoryId: 'cat_utilities' });
  });
  it('keeps two identical coffees (repeat in file is not a duplicate)', () => {
    const coffees = p.candidates.filter((c) => c.rawDescription.includes('STARBUCKS'));
    expect(coffees).toHaveLength(2);
    expect(coffees.every((c) => c.repeatInFile && c.include && c.duplicate === null)).toBe(true);
  });
  // The statement implies 1,196.00 before its first row on 09-03; rows sum to +1,609.01 → 2,805.01.
  const opening = acct({ openingBalanceCents: 119600 });
  it('reconciles against the closing balance', () => {
    const r = reconcilePreview(p, p.candidates, ctx({ account: opening }));
    expect(r).toMatchObject({ statementDate: '2026-09-12', statementBalanceCents: 280501, appBalanceCents: 280501, differenceCents: 0 });
  });
  it('reports a mismatch without changing anything', () => {
    const r = reconcilePreview(p, p.candidates.slice(1), ctx({ account: opening }));
    expect(r!.differenceCents).toBe(180000);
  });
});

describe('re-importing', () => {
  const { table, settings } = auto('signed-newest-first.csv');
  const first = buildPreview(table, settings, ctx());
  const imported: Transaction[] = first.candidates.map((c, i) => ({
    id: `t${i}`, accountId: 'chk', date: c.date, amountCents: c.amountCents, kind: c.kind === 'transfer' ? 'expense' : c.kind, status: 'confirmed',
    merchant: c.merchant, categoryId: c.categoryId, notes: '', provenance: { source: 'import', importBatchId: 'b1', rawDescription: c.rawDescription }, createdAt: T, updatedAt: T,
  }));
  const batch = { id: 'b1', fileHash: 'h1', accountId: 'chk', undoneAt: null } as ImportBatch;

  it('the same file is detected and every row is an exact duplicate (excluded by default)', () => {
    const p = buildPreview(table, settings, ctx({ transactions: imported, importBatches: [batch] }));
    expect(p.fileAlreadyImported?.id).toBe('b1');
    expect(p.candidates.every((c) => c.duplicate?.level === 'exact' && !c.include)).toBe(true);
  });

  it('a manually entered purchase is flagged as a likely duplicate, not assumed', () => {
    const manual: Transaction = { ...imported[2]!, id: 'm1', merchant: "Trader Joe's", date: '2026-09-07', provenance: { source: 'manual' } };
    const p = buildPreview(table, settings, ctx({ transactions: [manual] }));
    const c = p.candidates.find((x) => x.rawDescription.startsWith('TRADER'))!;
    expect(c.duplicate).toMatchObject({ level: 'likely', txId: 'm1' });
    expect(c.include).toBe(false);
  });

  it('the same amount on a different date is NOT a duplicate', () => {
    const other: Transaction = { ...imported[2]!, id: 'm2', date: '2026-08-20', provenance: { source: 'manual' } };
    const p = buildPreview(table, settings, ctx({ transactions: [other] }));
    expect(p.candidates.find((x) => x.rawDescription.startsWith('TRADER'))!.duplicate).toBeNull();
  });
});

describe('debit / credit columns', () => {
  const { table, settings } = auto('debit-credit.csv');
  const p = buildPreview(table, settings, ctx());
  it('combines debit and credit', () => {
    expect(settings.columns).toMatchObject({ debit: 2, credit: 3 });
    expect(p.candidates.map((c) => c.amountCents)).toEqual([-1549, -20000, 4500, -4820]);
    expect(p.errors).toEqual([expect.objectContaining({ rowNumber: 2, reason: 'Missing amount.' })]);
  });
  it('flags transfers and does not select them until confirmed', () => {
    const t = p.candidates.find((c) => c.rawDescription.includes('TRANSFER'))!;
    expect(t.looksLikeTransfer).toBe(true);
    expect(t.include).toBe(false);
  });
  it('keeps quoted commas in descriptions', () => {
    expect(p.candidates.some((c) => c.rawDescription === 'SHELL OIL 5741, SPRINGFIELD' && c.categoryId === 'cat_fuel')).toBe(true);
  });
});

describe('semicolon CSV with comma decimals', () => {
  it('parses European formats', () => {
    const { table, settings } = auto('semicolon-comma.csv');
    expect(settings.decimalSeparator).toBe(',');
    expect(settings.dateFormat).toBe('DD.MM.YYYY');
    const p = buildPreview(table, settings, ctx());
    expect(p.candidates.map((c) => [c.date, c.amountCents])).toEqual([['2026-09-03', -2345], ['2026-09-04', 250000], ['2026-09-05', -110000]]);
    expect(p.runningBalanceConsistent).toBe(true);
  });
});

describe('credit card statement with positive purchases', () => {
  const card = acct({ id: 'card', type: 'credit_card', spendable: false, openingBalanceCents: 0 });
  it('suggests inverting signs and classifies payment and return', () => {
    const { table, settings } = auto('card-positive.csv', card);
    expect(settings.signConvention).toBe('invert');
    const p = buildPreview(table, settings, ctx({ account: card, accounts: [card] }));
    const by = (d: string) => p.candidates.find((c) => c.rawDescription.startsWith(d))!;
    expect(by('UBER EATS')).toMatchObject({ amountCents: -2350, kind: 'expense', categoryId: 'cat_dining' });
    expect(by('PAYMENT THANK YOU')).toMatchObject({ amountCents: 50000, looksLikeTransfer: true, include: false });
    expect(by('TARGET RETURN')).toMatchObject({ amountCents: 1200, kind: 'refund', categoryId: 'cat_shopping' });
  });
});

describe('ambiguous dates', () => {
  it('returns both formats so the user must choose', () => {
    const table = csvParser.parse(fx('ambiguous-dates.csv'));
    const g = guessMapping(table);
    expect(g.dateFormats).toEqual(expect.arrayContaining(['MM/DD/YYYY', 'DD/MM/YYYY']));
    const s = (f: 'MM/DD/YYYY' | 'DD/MM/YYYY') => buildPreview(table, { hasHeader: true, columns: g.columns!, dateFormat: f, decimalSeparator: '.', signConvention: 'as_is' }, ctx());
    expect(s('DD/MM/YYYY').candidates[0]!.date).toBe('2026-09-03');
    expect(s('MM/DD/YYYY').candidates[0]!.date).toBe('2026-03-09');
  });
});

describe('messy real-world file', () => {
  const { table, settings } = auto('messy.csv');
  const p = buildPreview(table, settings, ctx());
  it('skips the preamble, reads CR/DR and parentheses, reports bad rows', () => {
    expect(settings.columns).toMatchObject({ date: 0, description: 1, amount: 2, externalId: 3 });
    expect(p.candidates.map((c) => [c.rawDescription, c.amountCents, c.externalId])).toEqual([
      ["Joe's Diner, Main St", -1840, 'A001'],
      ['Deposit "Mobile"', 25000, 'A002'],
      ['Gym membership', -4500, 'A003'],
      ['Rent', -140000, 'A006'],
    ]);
    expect(p.errors.map((e) => e.rowNumber)).toEqual([9, 10]);
    expect(p.skippedBlank).toBe(1);
  });
  it('flags rows before the opening date as history', () => {
    expect(p.candidates[0]!.reasons.join(' ')).toMatch(/opening date/);
  });
});
