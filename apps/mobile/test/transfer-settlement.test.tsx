import { act, fireEvent, render } from '@testing-library/react-native';
import { applyOps, buildDemoWorkspace, type Ctx } from '@clarity/data';
import type { Transaction, WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)), digestStringAsync: async () => 'hash', CryptoDigestAlgorithm: { SHA256: 'SHA256' } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));
let mockFile = '';
jest.mock('../src/platform/files', () => ({ pickTextFile: async () => ({ name: 'savings.csv', size: mockFile.length, text: mockFile }) }));
let mockData: WorkspaceData;
const mockRun = jest.fn();
jest.mock('../src/state/session', () => ({
  useData: () => mockData,
  useSession: () => ({ today: '2026-11-13', pendingRecoveryKey: null }),
  useRun: () => mockRun,
  useStore: () => ({ store: { undo: jest.fn() } }),
}));

import AddScreen from '../app/add';
import ImportScreen from '../app/import';
import Transactions from '../app/(tabs)/transactions';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.5.14 on mobile: component tests in Node (the real screens with the file picker mocked), not a simulator or
 * a device. The same rules as the web app and the data layer (packages/data/test/transfer-settlement.test.ts).
 */
let seq = 0;
const ctx = (): Ctx => ({ data: mockData, now: SAMPLE_NOW, today: SAMPLE_TODAY, newId: (p) => `${p}_${++seq}` });
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
beforeEach(() => {
  mockRun.mockImplementation(async (fn: (c: Ctx) => unknown) => {
    try { const r = fn(ctx()) as { ops?: unknown[] } | unknown[]; mockData = applyOps(mockData, (Array.isArray(r) ? r : r.ops) as never); return { ok: true }; }
    catch (e: any) { return { ok: false, errors: e.issues ?? [{ field: 'form', message: String(e) }] }; }
  });
});
const demo = () => buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
const acct = (d: WorkspaceData, name: string) => d.accounts.find((a) => a.name === name)!.id;
const selected = (ui: Awaited<ReturnType<typeof render>>, label: string) => ui.getByRole('button', { name: label }).props.accessibilityState.selected;

describe('D7: the Add form never keeps a hidden pending setting', () => {
  it('Expense with Pending ticked → Transfer: the transfer Status shows "Not posted by either bank yet" (no hidden checkbox); saved as pending on both legs', async () => {
    mockData = demo();
    const before = mockData.transactions.length;
    const ui = await render(<AddScreen />);
    await act(async () => { fireEvent.press(ui.getByText('Notes or pending')); });
    await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: 'Pending (not yet cleared)' })); });
    await act(async () => { fireEvent.press(ui.getByRole('radio', { name: 'Transfer' })); });
    expect(ui.getByTestId('transfer-status')).toBeTruthy();
    expect(selected(ui, 'Not posted by either bank yet')).toBe(true);
    expect(ui.queryByRole('checkbox', { name: 'Pending (not yet cleared)' })).toBeNull();
    for (const k of ['1', '0', '0']) await act(async () => { fireEvent.press(ui.getByLabelText(k)); });
    await act(async () => { fireEvent.press(ui.getByText('To Savings')); });
    await act(async () => { fireEvent.press(ui.getByText('Save')); });
    const legs = mockData.transactions.slice(before);
    expect(legs.map((t) => [t.kind, t.status])).toEqual([['transfer', 'pending'], ['transfer', 'pending']]);
  });
  it('Transfer "Sent · awaiting deposit" saves the sending leg posted and the receiving leg pending; back to Expense shows Pending ticked', async () => {
    mockData = demo();
    const before = mockData.transactions.length;
    const ui = await render(<AddScreen />);
    await act(async () => { fireEvent.press(ui.getByRole('radio', { name: 'Transfer' })); });
    expect(selected(ui, 'Posted by both banks')).toBe(true); // the default, as before
    await act(async () => { fireEvent.press(ui.getByText('Sent · awaiting deposit')); });
    await act(async () => { fireEvent.press(ui.getByRole('radio', { name: 'Expense' })); });
    expect(ui.getByRole('checkbox', { name: 'Pending (not yet cleared)' }).props.accessibilityState.checked).toBe(true);
    await act(async () => { fireEvent.press(ui.getByRole('radio', { name: 'Transfer' })); });
    expect(selected(ui, 'Not posted by either bank yet')).toBe(true); // a pending item becomes pending on both sides, visibly
    await act(async () => { fireEvent.press(ui.getByText('Sent · awaiting deposit')); });
    for (const k of ['5', '0']) await act(async () => { fireEvent.press(ui.getByLabelText(k)); });
    await act(async () => { fireEvent.press(ui.getByText('To Savings')); });
    await act(async () => { fireEvent.press(ui.getByText('Save')); });
    const legs = mockData.transactions.slice(before);
    expect(legs.map((t) => [t.amountCents, t.status])).toEqual([[-5000, 'confirmed'], [5000, 'pending']]);
  });
});

describe('D1: the transaction list says where each leg is', () => {
  it('a transfer sent but not yet deposited: both rows say so; neither says it posted', async () => {
    const d = demo();
    const chk = acct(d, 'Everyday Checking');
    const sav = acct(d, 'Savings');
    const base = { date: '2026-11-12', kind: 'transfer', merchant: 'Transfer', categoryId: null, notes: '', transferGroupId: 'tg_x', provenance: { source: 'manual' }, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW };
    mockData = { ...d, transactions: [...d.transactions, { ...base, id: 'out', accountId: chk, amountCents: -10000, status: 'confirmed' } as Transaction, { ...base, id: 'in', accountId: sav, amountCents: 10000, status: 'pending' } as Transaction] };
    const ui = await render(<Transactions />);
    expect(ui.getByText('Sent · awaiting deposit in Savings')).toBeTruthy();
    expect(ui.getByText('Sent from Everyday Checking · awaiting deposit')).toBeTruthy();
  });
});

describe('D6/D4/D8: the import review on mobile', () => {
  async function toReview(csv: string) {
    mockFile = 'Date,Description,Amount,Balance\n' + csv;
    const ui = await render(<ImportScreen />);
    await act(async () => { fireEvent.press(ui.getByText('Savings')); });
    await act(async () => { fireEvent.press(ui.getByText('Choose CSV file')); });
    await wait(); await wait();
    await act(async () => { fireEvent.press(ui.getByText('Review transactions')); });
    await wait(); await wait();
    return ui;
  }
  it('$100 sent, $95 arrived: the fee choice names the fee and where it is recorded; after import: "Import complete", 1 linked, 1 fee, 1 transfer awaiting', async () => {
    const d = demo();
    const chk = acct(d, 'Everyday Checking');
    const sav = acct(d, 'Savings');
    const base = { date: '2026-11-10', kind: 'transfer', merchant: 'Transfer', categoryId: null, notes: '', transferGroupId: 'tg_f', provenance: { source: 'manual' }, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW, status: 'pending' };
    mockData = { ...d, transactions: [...d.transactions, { ...base, id: 'out', accountId: chk, amountCents: -10000 } as Transaction, { ...base, id: 'in', accountId: sav, amountCents: 10000 } as Transaction] };
    const ui = await toReview('2026-11-12,WIRE IN,95.00,5295.00\n');
    const label = "It's this one, and the bank charged a $5.00 transfer fee (recorded as spending in Everyday Checking): Nov 10 · Transfer · +$100.00 · Savings · pending · transfer · statement differs by −$5.00";
    await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: label })); });
    expect([ui.getByTestId('match-note-2').props.children].flat().join('')).toMatch(/Only this account's side of the transfer is linked\. The Everyday Checking side stays as it is.*records the transfer as \$95\.00 and the \$5\.00 fee as a separate expense in Everyday Checking/);
    await act(async () => { fireEvent.press(ui.getByText('Link 1 to existing')); });
    await wait();
    expect(ui.getByText('Import complete')).toBeTruthy();
    expect(ui.getByTestId('import-result').props.children).toBe('0 new transactions imported · 1 existing transaction linked (1 marked posted) · 1 transfer fee recorded · 1 transfer awaiting the other bank');
    const legs = mockData.transactions.filter((t) => t.transferGroupId === 'tg_f');
    expect(legs.map((t) => [t.id, t.amountCents, t.status])).toEqual([['out', -9500, 'pending'], ['in', 9500, 'confirmed']]);
  });
  it('an old pending withdrawal (Oct 20) is listed under "Older pending transactions" for a Nov 12 row', async () => {
    const d = demo();
    const sav = acct(d, 'Savings');
    mockData = { ...d, transactions: [...d.transactions, { id: 'old', accountId: sav, date: '2026-10-20', amountCents: -20000, kind: 'expense', merchant: 'Check #12', categoryId: null, notes: '', status: 'pending', provenance: { source: 'manual' }, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW } as Transaction] };
    const ui = await toReview('2026-11-12,CHECK 12,-200.00,5000.00\n');
    expect([ui.getByTestId('match-stale-2').props.children].flat().join('')).toBe('Older pending transactions (outside the normal 10-day matching window)');
    expect(ui.getByRole('checkbox', { name: "It's this one: Oct 20 · Check #12 · −$200.00 · Savings · pending · entered 23 days before this row, outside the normal 10-day matching window" })).toBeTruthy();
  });
});

describe('Phase 4A.5.17 on mobile: returned card payments and card wording', () => {
  const withCardPayment = () => {
    const d = demo();
    const chk = acct(d, 'Everyday Checking');
    const card = { id: 'store', name: 'Store card', type: 'credit_card', currency: 'USD', openingBalanceCents: -25000, openingDate: '2026-11-01', spendable: false, archived: false, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW };
    const base = { date: '2026-11-12', kind: 'transfer', merchant: 'Transfer', categoryId: null, notes: '', transferGroupId: 'tg_c', provenance: { source: 'manual' }, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW };
    return { ...d, accounts: [...d.accounts, card], transactions: [...d.transactions, { ...base, id: 'cout', accountId: chk, amountCents: -10000, status: 'confirmed' }, { ...base, id: 'cin', accountId: 'store', amountCents: 10000, status: 'pending' }] } as WorkspaceData;
  };
  it('the list says "awaiting posting by Store card" (not "deposit")', async () => {
    mockData = withCardPayment();
    const ui = await render(<Transactions />);
    expect(ui.getByText('Sent · awaiting posting by Store card')).toBeTruthy();
    expect(ui.getByText('Sent from Everyday Checking · awaiting posting by Store card')).toBeTruthy();
  });
  it('a returned-payment row offers "It\'s the return of this card payment"; confirming it records the return, not income', async () => {
    mockData = withCardPayment();
    mockFile = 'Date,Description,Amount,Balance\n2026-11-13,RETURNED PAYMENT STORE CARD,100.00,2871.23\n';
    const ui = await render(<ImportScreen />);
    await act(async () => { fireEvent.press(ui.getByText('Everyday Checking')); });
    await act(async () => { fireEvent.press(ui.getByText('Choose CSV file')); });
    await wait(); await wait();
    await act(async () => { fireEvent.press(ui.getByText('Review transactions')); });
    await wait(); await wait();
    const label = "It's the return of this card payment: Nov 12 · Transfer · −$100.00 · Everyday Checking · posted · transfer · card payment";
    await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: label })); });
    expect([ui.getByTestId('match-note-2').props.children].flat().join('')).toMatch(/payment as returned: it no longer counts as paying Store card/);
    await act(async () => { fireEvent.press(ui.getByText('Record 1 returned payment')); }); // Phase 4A.5.18: the button says what it does
    await wait();
    expect(ui.getByTestId('import-result').props.children).toBe('0 new transactions imported · 1 returned card payment recorded');
    const ret = mockData.transactions.filter((t) => t.returnOf === 'tg_c');
    expect(ret.map((t) => [t.accountId === 'store' ? 'card' : 'checking', t.amountCents, t.kind, t.status])).toEqual([['checking', 10000, 'transfer', 'confirmed'], ['card', -10000, 'transfer', 'pending']]);
  });
});

describe('Phase 4A.5.18 on mobile: a returned card payment typed in by hand', () => {
  it('$100 income offered as the return of the card payment; a decision is required; choosing it records a return (not income)', async () => {
    const d = demo();
    const chk = acct(d, 'Everyday Checking');
    const card = { id: 'store', name: 'Store card', type: 'credit_card', currency: 'USD', openingBalanceCents: -25000, openingDate: '2026-11-01', spendable: false, archived: false, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW };
    const base = { date: '2026-11-12', kind: 'transfer', merchant: 'Transfer', categoryId: null, notes: '', transferGroupId: 'tg_m', provenance: { source: 'manual' }, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW, status: 'pending' };
    mockData = { ...d, settings: { ...d.settings, defaultAccountId: chk }, accounts: [...d.accounts, card], transactions: [...d.transactions, { ...base, id: 'mout', accountId: chk, amountCents: -10000 }, { ...base, id: 'min', accountId: 'store', amountCents: 10000 }] } as WorkspaceData;
    const before = mockData.transactions.length;
    const ui = await render(<AddScreen />);
    await act(async () => { fireEvent.press(ui.getByRole('radio', { name: 'Income' })); });
    for (const k of ['1', '0', '0']) await act(async () => { fireEvent.press(ui.getByLabelText(k)); });
    expect(ui.getByTestId('return-check')).toBeTruthy();
    await act(async () => { fireEvent.press(ui.getByText('Save')); });
    expect(ui.getByText('Choose whether this is a returned card payment, or close to decide later.')).toBeTruthy();
    expect(mockData.transactions.length).toBe(before);
    await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: "It's the return of this card payment: Nov 12 · Transfer · −$100.00 · Everyday Checking · pending · transfer · card payment" })); });
    expect(ui.queryByText('Choose whether this is a returned card payment, or close to decide later.')).toBeNull();
    await act(async () => { fireEvent.press(ui.getByText('Save')); });
    const added = mockData.transactions.slice(before);
    expect(added.map((t) => [t.accountId === 'store' ? 'card' : 'checking', t.amountCents, t.kind, t.returnOf])).toEqual([['checking', 10000, 'transfer', 'tg_m'], ['card', -10000, 'transfer', 'tg_m']]);
  });
});
