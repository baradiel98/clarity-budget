import { describe, expect, it } from 'vitest';
import { formatCents } from '@clarity/shared';
import { budgetSummary, buildDashboard, historyEstimate } from '@clarity/engine';
import { buildDemoWorkspace, engineInput, estimateNote, recurringAmountView } from '../src';
import { SAMPLE_NOW, SAMPLE_TODAY } from './fixtures/home-sample-nov13';

const data = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
const electricity = data.recurring.find((r) => r.name === 'Electricity')!;

describe('Phase 3A: estimated bill amounts (Planning vs forecast)', () => {
  it('$88.00 is the usual amount the user entered; $91.40 is what the forecast uses (history average)', () => {
    expect(electricity.amount).toEqual({ type: 'variable', cents: 8800 });
    expect(historyEstimate(electricity.id, data.transactions)).toBe(9140);
    const v = recurringAmountView(electricity, data.transactions);
    expect(v).toEqual({ kind: 'estimate', forecastCents: 9140, typicalCents: 8800, basis: 'history_average' });
    // Planning now shows the same figure as Upcoming / the forecast
    const up = buildDashboard(engineInput(data, SAMPLE_TODAY)).upcoming.find((u) => u.label === 'Electricity')!;
    expect(up.cents).toBe(-9140);
    expect(estimateNote(v as Extract<typeof v, { kind: 'estimate' }>, (c) => formatCents(c))).toBe('Estimate: average of recent payments (your usual: $88.00)');
  });

  it('without payment history the forecast uses the usual amount, and says so', () => {
    const v = recurringAmountView(electricity, []);
    expect(v).toEqual({ kind: 'estimate', forecastCents: 8800, typicalCents: 8800, basis: 'user_estimate' });
    expect(estimateNote(v as Extract<typeof v, { kind: 'estimate' }>, (c) => formatCents(c))).toBe('Estimate: your usual amount (no payments recorded yet)');
  });

  it('fixed, unknown and card-balance items are passed through unchanged', () => {
    const kinds = data.recurring.map((r) => [r.name, recurringAmountView(r, data.transactions).kind]);
    expect(kinds).toEqual([['Paycheck', 'fixed'], ['Rent', 'fixed'], ['Electricity', 'estimate'], ['Phone', 'fixed'], ['Streaming', 'fixed'], ['Card payment', 'card_full_balance'], ['Savings', 'fixed']]);
  });
});

describe('Phase 3A: sample budgets', () => {
  it('the sample workspace has a few budgets, so the Budget screen is not all zeros', () => {
    const b = budgetSummary(data.categories, data.transactions, '2026-11-01', '2026-11-30');
    const budgeted = b.rows.filter((r) => r.budgetCents !== null);
    expect(budgeted.map((r) => r.categoryId).sort()).toEqual(['cat_coffee', 'cat_dining', 'cat_entertainment', 'cat_fuel', 'cat_groceries', 'cat_shopping', 'cat_transport']);
    expect(b.budgetedCents).toBe(96000);
  });
});
