import { describe, expect, it } from 'vitest';
import { findOrphanTransferLegs, findPossibleDuplicates, runEngineSelfTest, suggestOccurrenceMatch, validateTransaction, validateTransferPair, cleanMerchant, similarity, type Occurrence } from '../src';
import { account, transfer, tx } from './builders';

const accts = [account({ id: 'chk' }), account({ id: 'sav', type: 'savings' }), account({ id: 'eur', currency: 'EUR' })];
const cats = [{ id: 'c1', name: 'A', group: 'g', icon: 'x', kind: 'expense' as const, archived: false, createdAt: 0, updatedAt: 0 }];

describe('golden self-test', () => {
  it('reproduces every recorded scenario', () => {
    expect(runEngineSelfTest().filter((r) => !r.ok)).toEqual([]);
  });
});

describe('validation', () => {
  it('enforces sign rules per kind', () => {
    expect(validateTransaction(tx({ accountId: 'chk', date: '2026-09-01', amountCents: 100, kind: 'expense' }), accts, cats)).not.toEqual([]);
    expect(validateTransaction(tx({ accountId: 'chk', date: '2026-09-01', amountCents: -100, kind: 'income' }), accts, cats)).not.toEqual([]);
    expect(validateTransaction(tx({ accountId: 'chk', date: '2026-09-01', amountCents: -100, kind: 'expense' }), accts, cats)).toEqual([]);
    expect(validateTransaction(tx({ accountId: 'chk', date: '2026-02-30', amountCents: -100, kind: 'expense' }), accts, cats)[0]!.field).toBe('date');
    expect(validateTransaction(tx({ accountId: 'chk', date: '2026-09-01', amountCents: 5, kind: 'adjustment' }), accts, cats)[0]!.field).toBe('notes');
  });
  it('validates splits', () => {
    const ok = tx({ accountId: 'chk', date: '2026-09-01', amountCents: -100, kind: 'expense', splits: [{ categoryId: 'c1', amountCents: -60 }, { categoryId: 'c1', amountCents: -40 }] });
    expect(validateTransaction(ok, accts, cats)).toEqual([]);
    const bad = { ...ok, splits: [{ categoryId: 'c1', amountCents: -60 }, { categoryId: 'c1', amountCents: 40 }] };
    expect(validateTransaction(bad, accts, cats).map((i) => i.message)).toEqual(expect.arrayContaining(['Split parts must add up exactly to the total.']));
  });
  it('validates transfer pairs and finds orphans', () => {
    const legs = transfer('chk', 'sav', '2026-09-01', 500);
    expect(validateTransferPair(legs, accts)).toEqual([]);
    expect(validateTransferPair([legs[0]!, { ...legs[1]!, amountCents: 400 }], accts)).not.toEqual([]);
    expect(validateTransferPair(transfer('chk', 'eur', '2026-09-01', 500), accts)[0]!.message).toMatch(/currencies/);
    expect(findOrphanTransferLegs([legs[0]!])).toEqual([legs[0]!.transferGroupId]);
  });
});

describe('matching', () => {
  it('manual duplicate warning needs the same account, amount, date and merchant', () => {
    const existing = [tx({ accountId: 'chk', date: '2026-09-01', amountCents: -650, merchant: 'Blue Bottle' })];
    expect(findPossibleDuplicates({ accountId: 'chk', date: '2026-09-01', amountCents: -650, merchant: 'blue bottle' }, existing)).toHaveLength(1);
    expect(findPossibleDuplicates({ accountId: 'chk', date: '2026-09-02', amountCents: -650, merchant: 'Blue Bottle' }, existing)).toHaveLength(0);
    expect(findPossibleDuplicates({ accountId: 'chk', date: '2026-09-01', amountCents: -650, merchant: 'Other' }, existing)).toHaveLength(0);
  });
  it('suggests the matching bill occurrence', () => {
    const occ = (p: Partial<Occurrence>): Occurrence => ({ key: 'k', recurringId: 'r', name: 'Rent', kind: 'bill', accountId: 'chk', categoryId: null, originalDate: '2026-09-01', date: '2026-09-01', amountCents: 140000, amountBasis: 'fixed', status: 'expected', ...p });
    expect(suggestOccurrenceMatch({ accountId: 'chk', date: '2026-09-02', amountCents: -140000, merchant: 'RENT PAYMENT' }, [occ({})])).not.toBeNull();
    expect(suggestOccurrenceMatch({ accountId: 'chk', date: '2026-09-02', amountCents: -139000, merchant: 'RENT' }, [occ({})])).toBeNull();
    expect(suggestOccurrenceMatch({ accountId: 'chk', date: '2026-09-20', amountCents: -140000, merchant: 'RENT' }, [occ({})])).toBeNull();
    expect(suggestOccurrenceMatch({ accountId: 'chk', date: '2026-09-02', amountCents: -9500, merchant: 'POWER' }, [occ({ amountBasis: 'history_average', amountCents: 9000, status: 'estimated' })])).not.toBeNull();
  });
  it('cleans merchants conservatively', () => {
    expect(cleanMerchant('POS STARBUCKS #1234')).toBe('Starbucks');
    expect(cleanMerchant('Blue Bottle Coffee')).toBe('Blue Bottle Coffee');
    expect(similarity('AMAZON MKTPLACE PMTS', 'Amazon Mktplace')).toBeGreaterThan(0.5);
  });
});
