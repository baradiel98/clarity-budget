import type { Category } from './types';

/** Default categories. Icons are lucide icon names (same names in lucide-react and lucide-react-native). */
export const DEFAULT_CATEGORIES: ReadonlyArray<Omit<Category, 'createdAt' | 'updatedAt' | 'archived'>> = [
  { id: 'cat_groceries', name: 'Groceries', group: 'Everyday', icon: 'shopping-basket', kind: 'expense' },
  { id: 'cat_dining', name: 'Dining out', group: 'Everyday', icon: 'utensils', kind: 'expense' },
  { id: 'cat_coffee', name: 'Coffee', group: 'Everyday', icon: 'coffee', kind: 'expense' },
  { id: 'cat_transport', name: 'Transport', group: 'Everyday', icon: 'car', kind: 'expense' },
  { id: 'cat_fuel', name: 'Fuel', group: 'Everyday', icon: 'fuel', kind: 'expense' },
  { id: 'cat_shopping', name: 'Shopping', group: 'Lifestyle', icon: 'shopping-bag', kind: 'expense' },
  { id: 'cat_entertainment', name: 'Entertainment', group: 'Lifestyle', icon: 'clapperboard', kind: 'expense' },
  { id: 'cat_health', name: 'Health', group: 'Lifestyle', icon: 'heart-pulse', kind: 'expense' },
  { id: 'cat_personal', name: 'Personal care', group: 'Lifestyle', icon: 'sparkles', kind: 'expense' },
  { id: 'cat_gifts', name: 'Gifts', group: 'Lifestyle', icon: 'gift', kind: 'expense' },
  { id: 'cat_travel', name: 'Travel', group: 'Lifestyle', icon: 'plane', kind: 'expense' },
  { id: 'cat_housing', name: 'Rent & mortgage', group: 'Bills', icon: 'house', kind: 'expense' },
  { id: 'cat_utilities', name: 'Utilities', group: 'Bills', icon: 'zap', kind: 'expense' },
  { id: 'cat_internet', name: 'Internet & phone', group: 'Bills', icon: 'wifi', kind: 'expense' },
  { id: 'cat_insurance', name: 'Insurance', group: 'Bills', icon: 'shield', kind: 'expense' },
  { id: 'cat_subscriptions', name: 'Subscriptions', group: 'Bills', icon: 'repeat', kind: 'expense' },
  { id: 'cat_loans', name: 'Loan payments', group: 'Bills', icon: 'landmark', kind: 'expense' },
  { id: 'cat_fees', name: 'Fees & interest', group: 'Bills', icon: 'receipt', kind: 'expense' },
  { id: 'cat_education', name: 'Education', group: 'Other', icon: 'graduation-cap', kind: 'expense' },
  { id: 'cat_kids', name: 'Kids & family', group: 'Other', icon: 'baby', kind: 'expense' },
  { id: 'cat_pets', name: 'Pets', group: 'Other', icon: 'paw-print', kind: 'expense' },
  { id: 'cat_other', name: 'Other', group: 'Other', icon: 'circle-dashed', kind: 'expense' },
  { id: 'cat_paycheck', name: 'Paycheck', group: 'Income', icon: 'briefcase', kind: 'income' },
  { id: 'cat_other_income', name: 'Other income', group: 'Income', icon: 'hand-coins', kind: 'income' },
];

export function defaultCategories(now: number): Category[] {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c, archived: false, createdAt: now, updatedAt: now }));
}
