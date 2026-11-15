import { act, fireEvent, render } from '@testing-library/react-native';
import { addTransaction, applyOps, buildDemoWorkspace, createRecurring, deleteRecurring, linkTransactionToOccurrence, type Ctx } from '@clarity/data';
import { engineInput } from '@clarity/data';
import { computeSafeToSpend } from '@clarity/engine';
import type { WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)), digestStringAsync: async () => 'hash', CryptoDigestAlgorithm: { SHA256: 'SHA256' } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));
let mockFile = '';
jest.mock('../src/platform/files', () => ({ pickTextFile: async () => ({ name: 'checking.csv', size: mockFile.length, text: mockFile }) }));
let mockData: WorkspaceData;
const mockRun = jest.fn();
jest.mock('../src/state/session', () => ({
  useData: () => mockData,
  useSession: () => ({ today: '2026-11-13', pendingRecoveryKey: null }),
  useRun: () => mockRun,
  useStore: () => ({ store: { undo: jest.fn() } }),
}));

import ImportScreen from '../app/import';
import AddScreen from '../app/add';
import { setAddPrefill } from '../src/state/nav';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.9 on mobile: scheduled-item suggestions. Component tests in Node (the real screens), not a simulator or a
 * device. The sample schedules Electricity (variable, estimated $91.40, due Nov 18) from Everyday Checking.
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
const sts = () => computeSafeToSpend(engineInput(mockData, SAMPLE_TODAY)).cents;
async function toReview(csv: string) {
  mockFile = 'Date,Description,Amount,Balance\n' + csv;
  const ui = await render(<ImportScreen />);
  await act(async () => { fireEvent.press(ui.getByText('Everyday Checking')); });
  await act(async () => { fireEvent.press(ui.getByText('Choose CSV file')); });
  await wait(); await wait();
  await act(async () => { fireEvent.press(ui.getByText('Review transactions')); });
  await wait(); await wait();
  return ui;
}

describe('Phase 4A.9 on mobile: scheduled-item suggestions', () => {
  it('amount and date only ("ONLINE PMT 7781 −$100"): "Pays Electricity?" unticked with the reason; imported without the link → Safe to Spend −$100', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const before = sts();
    const ui = await toReview('2026-11-12,ONLINE PMT 7781,-100.00,2771.23\n');
    expect(ui.getByRole('checkbox', { name: 'Pays Electricity?' }).props.accessibilityState.checked).toBe(false);
    expect([ui.getByTestId('occurrence-weak-2').props.children].flat().join('')).toBe('Could be Electricity (due Nov 18): only the amount and date are close. Not linked unless you tick it.');
    await act(async () => { fireEvent.press(ui.getByText('Import 1 transaction')); });
    await wait();
    expect(ui.getByText('Import complete')).toBeTruthy();
    // Checking −100; Electricity still due
    expect([sts() - before, mockData.transactions.filter((t) => t.provenance.source === 'import').map((t) => t.occurrenceRef ?? null)]).toEqual([-10000, [null]]);
  });
  it('the bill\'s name in the description ("CITY ELECTRICITY CO −$91.40"): "Pays Electricity" ticked; imported and linked → Safe to Spend unchanged', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const before = sts();
    const ui = await toReview('2026-11-12,CITY ELECTRICITY CO,-91.40,2779.83\n');
    expect(ui.getByRole('checkbox', { name: 'Pays Electricity' }).props.accessibilityState.checked).toBe(true);
    expect(ui.queryByTestId('occurrence-weak-2')).toBeNull();
    await act(async () => { fireEvent.press(ui.getByText('Import 1 transaction')); });
    await wait();
    // Checking −91.40, and the $91.40 Electricity estimate is no longer forecast
    expect([sts() - before, mockData.transactions.filter((t) => t.provenance.source === 'import').map((t) => t.occurrenceRef?.originalDate)]).toEqual([0, ['2026-11-18']]);
  });
  it('Add form: a $100 expense (no payee yet) near the Electricity due date is offered unticked, with the reason', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    setAddPrefill({ amountCents: 10000 });
    const ui = await render(<AddScreen />);
    const check = ui.getByRole('checkbox', { name: /This pays Electricity due Nov 18/ });
    expect(check.props.accessibilityState.checked).toBe(false);
    expect(ui.getByText(/Only the amount and date are close; the description doesn't mention it\./)).toBeTruthy();
  });

  // Phase 4A.10: Mark paid can link an existing transaction instead of adding a second one
  const phone = () => { const r = mockData.recurring.find((x) => x.name === 'Phone')!; return { recurringId: r.id, originalDate: '2026-11-22' }; };
  const verizon = () => {
    const chk = mockData.accounts.find((a) => a.name === 'Everyday Checking')!.id;
    const r = addTransaction(ctx(), { kind: 'expense', accountId: chk, date: '2026-11-13', amountCents: 6500, merchant: 'Verizon Wireless', categoryId: null });
    mockData = applyOps(mockData, r.ops);
    return r.txs[0]!;
  };
  it('Mark paid (Phone $65) offers the existing Verizon $65: a choice is required; linking adds nothing and the bill leaves the forecast (+$65 Safe to Spend)', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const t = verizon();
    const before = sts();
    const count = mockData.transactions.length;
    setAddPrefill({ occurrenceRef: phone(), occurrenceName: 'Phone', amountCents: 6500 });
    const ui = await render(<AddScreen />);
    expect([ui.getByTestId('mark-paid-scheduled').props.children].flat().join('')).toBe('Phone · due Nov 22 · $65.00 · Everyday Checking');
    await act(async () => { fireEvent.press(ui.getByText('Save')); });
    expect(ui.getByText('Choose the transaction that paid it, or “No, record a new payment”.')).toBeTruthy();
    await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: 'Nov 13 · Verizon Wireless · −$65.00 · Everyday Checking · posted' })); });
    expect(ui.getByTestId('mark-paid-note')).toBeTruthy();
    await act(async () => { fireEvent.press(ui.getByText('Link transaction')); });
    expect([mockData.transactions.length, mockData.transactions.find((x) => x.id === t.id)!.occurrenceRef, sts() - before]).toEqual([count, phone(), 6500]);
  });
  it('Edit form of the linked transaction: Unlink makes the bill due again', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const t = verizon();
    const before = sts();
    mockData = applyOps(mockData, linkTransactionToOccurrence(ctx(), t.id, phone()));
    setAddPrefill({ editId: t.id });
    const ui = await render(<AddScreen />);
    expect(ui.getByText('Records the scheduled payment Phone due Nov 22.')).toBeTruthy();
    await act(async () => { fireEvent.press(ui.getByText('Unlink')); });
    expect([mockData.transactions.find((x) => x.id === t.id)!.occurrenceRef, sts()]).toEqual([undefined, before]);
  });

  // Phase 4A.11: an overdue bill's late payment (Show older transactions) and links whose item is gone
  const gym = () => {
    const chk = mockData.accounts.find((a) => a.name === 'Everyday Checking')!.id;
    const r = createRecurring({ ...ctx(), today: '2026-09-01' }, { name: 'Gym', kind: 'bill', accountId: chk, categoryId: null, schedule: { freq: 'monthly', interval: 1, day: 15 as never, anchor: '2026-01-01' }, amount: { type: 'fixed', cents: 5000 } });
    mockData = applyOps(mockData, r.ops);
    const p = addTransaction(ctx(), { kind: 'expense', accountId: chk, date: '2026-10-20', amountCents: 5000, merchant: 'GYM CLUB', categoryId: null });
    mockData = applyOps(mockData, p.ops);
    return { rid: r.item.id, tx: p.txs[0]! };
  };
  it('Mark paid on the overdue Sep 15 gym bill: not listed by default; "Show older transactions" lists the Oct 20 payment (35 days after), unselected; linking adds nothing (+$50 Safe to Spend)', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const g = gym();
    const before = sts();
    const count = mockData.transactions.length;
    setAddPrefill({ occurrenceRef: { recurringId: g.rid, originalDate: '2026-09-15' }, occurrenceName: 'Gym', amountCents: 5000 });
    const ui = await render(<AddScreen />);
    expect(ui.queryByRole('radiogroup')).toBeNull();
    expect([ui.getByTestId('mark-paid-not-listed').props.children].flat().join('')).toBe('Not listed? If Gym was already paid some other way, Skip this occurrence in Planning instead of recording it again. Record a new payment only if you are paying it now.');
    await act(async () => { fireEvent.press(ui.getByText('Show older transactions')); });
    const label = 'Oct 20 · GYM CLUB · −$50.00 · Everyday Checking · posted · the description names it · 35 days after the due date';
    expect(ui.getByRole('checkbox', { name: label }).props.accessibilityState.checked).toBe(false);
    await act(async () => { fireEvent.press(ui.getByText('Save')); });
    expect(ui.getByText('Choose the transaction that paid it, or “No, record a new payment”.')).toBeTruthy();
    await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: label })); });
    expect(ui.queryByTestId('mark-paid-not-listed')).toBeNull(); // no "record a new payment" nudge once one is chosen
    await act(async () => { fireEvent.press(ui.getByText('Link transaction')); });
    expect([mockData.transactions.length, mockData.transactions.find((x) => x.id === g.tx.id)!.occurrenceRef, mockData.transactions.find((x) => x.id === g.tx.id)!.amountCents, sts() - before]).toEqual([count, { recurringId: g.rid, originalDate: '2026-09-15' }, -5000, 5000]);
  });
  it('the bill was deleted after linking: the Edit form explains it and still offers Unlink; unlinking leaves the transaction as it was', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const g = gym();
    mockData = applyOps(mockData, linkTransactionToOccurrence(ctx(), g.tx.id, { recurringId: g.rid, originalDate: '2026-10-15' }));
    mockData = applyOps(mockData, deleteRecurring(ctx(), g.rid));
    setAddPrefill({ editId: g.tx.id });
    const ui = await render(<AddScreen />);
    expect([ui.getByTestId('linked-occurrence-item_missing').props.children].flat().join('')).toBe("Linked to a scheduled payment whose scheduled item was deleted. Unlink it to clear the link (it isn't moved to any other item).");
    await act(async () => { fireEvent.press(ui.getByLabelText('Unlink from the scheduled payment')); });
    const t = mockData.transactions.find((x) => x.id === g.tx.id)!;
    expect([t.occurrenceRef, t.amountCents, t.date, t.status]).toEqual([undefined, -5000, '2026-10-20', 'confirmed']);
  });
});

