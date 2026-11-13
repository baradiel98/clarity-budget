import type { Account, OccurrenceException, RecurringItem, Transaction } from '@clarity/shared';
import type { EngineInput } from '../src/plan';

let n = 0;
const T = 1_700_000_000_000;

export function account(p: Partial<Account> & Pick<Account, 'id'>): Account {
  return {
    name: p.id, type: 'checking', currency: 'USD', openingBalanceCents: 0, openingDate: '2026-09-01',
    spendable: p.type !== 'credit_card' && p.type !== 'savings', archived: false, createdAt: T, updatedAt: T, ...p,
  };
}

export function tx(p: Partial<Transaction> & Pick<Transaction, 'accountId' | 'date' | 'amountCents'>): Transaction {
  n++;
  const kind = p.kind ?? (p.amountCents < 0 ? 'expense' : 'income');
  return {
    id: p.id ?? `tx${n}`, status: 'confirmed', merchant: p.merchant ?? 'Test', categoryId: null, notes: '',
    provenance: { source: 'manual' }, createdAt: T + n, updatedAt: T + n, kind, ...p,
  } as Transaction;
}

export function transfer(from: string, to: string, date: string, cents: number, extra: Partial<Transaction> = {}): Transaction[] {
  n++;
  const g = `tg${n}`;
  return [
    tx({ accountId: from, date, amountCents: -cents, kind: 'transfer', transferGroupId: g, id: `${g}a`, ...extra }),
    tx({ accountId: to, date, amountCents: cents, kind: 'transfer', transferGroupId: g, id: `${g}b`, ...extra }),
  ];
}

export function rec(p: Partial<RecurringItem> & Pick<RecurringItem, 'id' | 'kind' | 'schedule' | 'amount'>): RecurringItem {
  return {
    name: p.id, accountId: 'chk', categoryId: null, weekendRule: 'none', startDate: '2026-01-01', trackFrom: '2026-09-01',
    paused: false, createdAt: T, updatedAt: T, ...p,
  };
}

export function ex(p: Omit<OccurrenceException, 'id' | 'createdAt' | 'updatedAt'>): OccurrenceException {
  n++;
  return { id: `ex${n}`, createdAt: T, updatedAt: T, ...p };
}

export function input(p: Partial<EngineInput> & Pick<EngineInput, 'today'>): EngineInput {
  return { accounts: [], transactions: [], recurring: [], exceptions: [], baseCurrency: 'USD', minReserveCents: 0, ...p };
}
