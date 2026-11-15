import { act, fireEvent, render, within } from '@testing-library/react-native';
import { addTransaction, createAccount, MemoryAdapter, onboard, saveCaptured, WorkspaceStore, type CaptureItem } from '@clarity/data';
import { computeSafeToSpend } from '@clarity/engine';
import { engineInput } from '@clarity/data';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);

import { provider } from '../src/platform/crypto';
import { CaptureView } from '../src/features/Capture';
import { captureStore } from '../src/state/capture';

jest.setTimeout(120_000);
const TODAY = '2026-11-13';
const NOW = Date.UTC(2026, 10, 13, 15);

async function workspace() {
  const { store } = await WorkspaceStore.create(new MemoryAdapter(), provider, 'correct horse battery', { withRecoveryKey: false, now: NOW });
  await store.apply(onboard(store.ctx(NOW, '2026-11-01'), { checkingBalanceCents: 200000 }));
  await store.apply(createAccount(store.ctx(NOW, '2026-11-01'), { name: 'Chase Visa', type: 'credit_card', currentBalanceCents: 30000 }).ops);
  return store;
}

async function setUp(fail = false, payments: string[] = []) {
  captureStore.clear();
  const store = await workspace();
  // Phase 4A.7: $200 card payments Checking → Visa that Visa hasn't posted yet
  const legs: string[] = [];
  for (const date of payments) {
    const r = addTransaction(store.ctx(NOW, TODAY), { kind: 'transfer', accountId: store.data.accounts.find((a) => a.type === 'checking')!.id, toAccountId: store.data.accounts.find((a) => a.type === 'credit_card')!.id, date, amountCents: 20000, merchant: 'Payment to Chase Visa', categoryId: null, status: 'confirmed', toStatus: 'pending' });
    await store.apply(r.ops);
    legs.push(r.txs.find((t) => t.amountCents < 0)!.id);
  }
  const calls: CaptureItem[][] = [];
  const approve = jest.fn(async (inputs: CaptureItem[]) => {
    calls.push(inputs);
    if (fail) return 'Simulated storage failure.';
    await store.apply(saveCaptured(store.ctx(NOW, TODAY), inputs).ops);
    return null;
  });
  const ui = await render(<CaptureView data={store.data} today={TODAY} approve={approve} onAddManually={jest.fn()} />);
  const prepare = async (text: string) => {
    await fireEvent.changeText(ui.getByTestId('capture-text'), text);
    await fireEvent.press(ui.getByTestId('capture-read'));
  };
  return { store, ui, approve, calls, prepare, legs };
}
const sts = (store: WorkspaceStore) => computeSafeToSpend(engineInput(store.data, TODAY)).cents;

const captured = (store: WorkspaceStore) => store.data.transactions.filter((t) => t.provenance.source === 'capture');

describe('Clarity Capture (mobile)', () => {
  it('reads several items, shows drafts, saves only on approval', async () => {
    const { store, ui, prepare } = await setUp();
    await prepare('Yesterday I spent $45 at Walmart on groceries, $18 at Starbucks for coffee, and today I paid $65 for gas at Shell.');
    expect(await ui.findAllByTestId('draft')).toHaveLength(3);
    expect(ui.getByTestId('capture-summary')).toHaveTextContent(/3 drafts.*\$128\.00 out/);
    expect(captured(store)).toHaveLength(0); // drafts don't touch the data
    await fireEvent.press(ui.getByTestId('approve-all'));
    expect(await ui.findByTestId('capture-saved')).toHaveTextContent('Saved 3 transactions from Capture.');
    expect(captured(store).map((t) => [t.merchant, t.amountCents, t.date, t.categoryId])).toEqual([
      ['Walmart', -4500, '2026-11-12', 'cat_groceries'],
      ['Starbucks', -1800, '2026-11-12', 'cat_coffee'],
      ['Shell', -6500, TODAY, 'cat_fuel'],
    ]);
  });

  it('edits before approving are what gets saved; one draft can be approved alone', async () => {
    const { store, ui, prepare } = await setUp();
    await prepare('$30 at Walmart today, and $12 at CVS today');
    const [first] = await ui.findAllByTestId('draft');
    await fireEvent.press(within(first!).getByLabelText('Groceries'));
    await fireEvent.changeText(within(first!).getByLabelText('Amount'), '31.50');
    await fireEvent.press(within(first!).getByLabelText('Approve Walmart'));
    expect(await ui.findAllByTestId('draft')).toHaveLength(1);
    expect(captured(store).map((t) => [t.merchant, t.amountCents, t.categoryId])).toEqual([['Walmart', -3150, 'cat_groceries']]);
  });

  it('Prepare is disabled while the text is empty or only spaces (Phase 3A)', async () => {
    const { ui } = await setUp();
    expect(ui.getByTestId('capture-read')).toBeDisabled();
    await fireEvent.changeText(ui.getByTestId('capture-text'), '   ');
    expect(ui.getByTestId('capture-read')).toBeDisabled();
    await fireEvent.changeText(ui.getByTestId('capture-text'), 'coffee $4');
    expect(ui.getByTestId('capture-read')).toBeEnabled();
  });

  it('unclear items block approval until fixed or confirmed', async () => {
    const { ui, approve, prepare } = await setUp();
    await prepare('I paid 200.');
    const [d] = await ui.findAllByTestId('draft');
    expect(d).toHaveTextContent(/It isn’t clear what this was/);
    expect(ui.getByTestId('approve-all')).toBeDisabled();
    await fireEvent.changeText(within(d!).getByLabelText('Merchant'), 'Electric company');
    for (const b of within(d!).getAllByText('Confirm')) await fireEvent.press(b);
    expect(ui.getByTestId('approve-all')).toBeEnabled();
    expect(approve).not.toHaveBeenCalled();
  });

  it('a card payment is a transfer to the card, not spending', async () => {
    const { store, ui, prepare } = await setUp();
    await prepare('Paid $300 toward my credit card today');
    await ui.findAllByTestId('draft');
    await fireEvent.press(ui.getByTestId('approve-all'));
    await ui.findByTestId('capture-saved');
    const legs = captured(store);
    expect(legs.map((t) => [t.kind, t.amountCents])).toEqual([['transfer', -30000], ['transfer', 30000]]);
  });

  it('a failed save keeps every draft and says nothing was saved; text without amounts is reported', async () => {
    const { store, ui, prepare } = await setUp(true);
    await prepare('Went to the store. $9 at CVS today and $14 at Target today');
    expect(await ui.findAllByTestId('draft')).toHaveLength(2);
    expect(ui.getByTestId('not-understood')).toHaveTextContent(/Went to the store/);
    await fireEvent.press(ui.getByTestId('approve-all'));
    expect(await ui.findByText(/Nothing was saved: Simulated storage failure/)).toBeTruthy();
    expect(ui.getAllByTestId('draft')).toHaveLength(2);
    expect(captured(store)).toHaveLength(0);
  });

  it('drafts are cleared when the store is cleared (as on lock)', async () => {
    const { ui, prepare } = await setUp();
    await prepare('$9 at CVS today');
    await ui.findAllByTestId('draft');
    await act(async () => captureStore.clear());
    expect(ui.queryAllByTestId('draft')).toHaveLength(0);
  });

  // Phase 4A.7 (audit 4A.6 H1). Checking $2,000; Visa owes $300; a $200 payment on its way: 1,800 − (300 − 200) = $1,700.
  // Its return: Checking 2,000, Visa 300 → $1,700; as income it would be 2,000 − 100 = $1,900.
  it('a captured amount that could be a returned card payment needs a decision; confirming records the return → $1,700', async () => {
    const { store, ui, prepare, legs } = await setUp(false, ['2026-11-10']);
    expect(sts(store)).toBe(170000);
    await prepare('Received $200 today');
    const [d] = await ui.findAllByTestId('draft');
    expect(within(d!).getByTestId('capture-return-check')).toHaveTextContent(/Is this money a returned card payment\?.*It's the return of this card payment.*\$200\.00.*No, it's separate income/);
    expect(d).toHaveTextContent(/This could be a card payment coming back to you/);
    expect(ui.getByTestId('approve-all')).toBeDisabled();
    // Phase 4A.8 (N3): Category is shown while undecided, hidden once it's a returned card payment (as in the Add form)
    expect(within(d!).queryAllByText(/^Category/).length).toBeGreaterThan(0);
    await fireEvent.press(within(d!).getByTestId(`capture-return-${legs[0]}`));
    expect(within(d!).queryAllByText(/^Category/)).toHaveLength(0);
    expect(within(d!).getByTestId('capture-return-note')).toHaveTextContent(/It isn't counted as income/);
    await fireEvent.press(ui.getByTestId('approve-all'));
    await ui.findByTestId('capture-saved');
    expect([sts(store), store.data.transactions.filter((t) => t.returnOf).length, store.data.transactions.filter((t) => t.kind === 'income').length]).toEqual([170000, 2, 0]);
  });

  it('"separate income" saves it as income (the payment kept on record) → $1,900', async () => {
    const { store, ui, prepare, legs } = await setUp(false, ['2026-11-10']);
    await prepare('Received $200 paycheck today');
    const [d] = await ui.findAllByTestId('draft');
    await fireEvent.press(within(d!).getByTestId('capture-return-separate'));
    await fireEvent.press(ui.getByTestId('approve-all'));
    await ui.findByTestId('capture-saved');
    expect(within(d!).queryAllByText(/^Category/).length).toBeGreaterThan(0); // separate income keeps its category
    const inc = store.data.transactions.find((t) => t.kind === 'income')!;
    expect([sts(store), inc.provenance.separateFrom]).toEqual([190000, [legs[0]]]);
  });

  it('several items: the undecided one stays as a draft while the ready ones are approved; two possible payments are both offered', async () => {
    const { store, ui, prepare, legs } = await setUp(false, ['2026-11-05', '2026-11-10']);
    await prepare('I spent $12 at Starbucks today and received $200 today');
    const drafts = await ui.findAllByTestId('draft');
    expect(drafts).toHaveLength(2);
    expect(within(drafts[1]!).getByTestId(`capture-return-${legs[0]}`)).toBeTruthy();
    expect(within(drafts[1]!).getByTestId(`capture-return-${legs[1]}`)).toBeTruthy();
    expect(ui.getByTestId('approve-all')).toHaveTextContent('Approve 1 ready');
    await fireEvent.press(ui.getByTestId('approve-all'));
    expect(await ui.findAllByTestId('draft')).toHaveLength(1);
    expect(store.data.transactions.filter((t) => t.provenance.source === 'capture').map((t) => t.merchant)).toEqual(['Starbucks']);
    // nothing about the $200 was saved
    expect(store.data.transactions.filter((t) => t.kind === 'income' || t.returnOf).length).toBe(0);
  });
});
