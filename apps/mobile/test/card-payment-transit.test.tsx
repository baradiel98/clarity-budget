import { render } from '@testing-library/react-native';
import { buildDemoWorkspace, engineInput } from '@clarity/data';
import { computeSafeToSpend, type Explanation } from '@clarity/engine';
import type { Account, Transaction, WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
let mockCurrent: Explanation | null = null;
jest.mock('../src/state/nav', () => ({ takeExplain: () => mockCurrent }));
jest.mock('../src/state/session', () => ({ useData: () => ({ settings: { baseCurrency: 'USD' } }) }));

import Explain from '../app/explain';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.5.15 on mobile (component test in Node, not a simulator or device): the same scenario as
 * apps/web/e2e/phase4a515.spec.ts. Store card owes $250; a $100 payment from Everyday Checking pending at both banks
 * is counted once: $2,177.17 (4A.5.14: $2,077.17). The explanation names it.
 */
it('"Why this number?" names the card payment on its way and says it is counted once', async () => {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const chk = d.accounts.find((a) => a.name === 'Everyday Checking')!.id;
  const card: Account = { id: 'store', name: 'Store card', type: 'credit_card', currency: 'USD', openingBalanceCents: -25000, openingDate: SAMPLE_TODAY, spendable: false, archived: false, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW };
  const base = { date: SAMPLE_TODAY, kind: 'transfer', merchant: 'Transfer', categoryId: null, notes: '', transferGroupId: 'tg_p', status: 'pending', provenance: { source: 'manual' }, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW };
  const legs = [{ ...base, id: 'out', accountId: chk, amountCents: -10000 }, { ...base, id: 'in', accountId: 'store', amountCents: 10000 }] as Transaction[];
  const data: WorkspaceData = { ...d, accounts: [...d.accounts, card], transactions: [...d.transactions, ...legs] };
  const sts = computeSafeToSpend(engineInput(data, SAMPLE_TODAY));
  expect(sts.cents).toBe(217717);
  // the card issuer posts it, checking still pending: unchanged
  const posted = computeSafeToSpend(engineInput({ ...data, transactions: [...d.transactions, legs[0]!, { ...legs[1]!, status: 'confirmed' }] }, SAMPLE_TODAY));
  expect(posted.cents).toBe(217717);
  mockCurrent = sts.explanation;
  const ui = await render(<Explain />);
  expect(ui.getByText('Store card: $100.00 payment from Everyday Checking not yet posted by the card issuer')).toBeTruthy();
  expect(ui.getByText(/^already counted from Everyday Checking, so the \$100\.00 of card debt it pays isn't counted again\. If it's returned or rejected: when the returned money shows on a statement, choose "It's the return of this card payment" in the import review/)).toBeTruthy();
  expect(ui.getByText('Store card: owed now')).toBeTruthy();
});
