import { centsToDecimalString, type WorkspaceData } from '@clarity/shared';

/** Neutralize spreadsheet formula injection (cells starting with = + - @ tab or CR). */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Unencrypted CSV of all transactions. The UI must warn before calling this. */
export function exportTransactionsCsv(data: WorkspaceData): string {
  const acct = new Map(data.accounts.map((a) => [a.id, a]));
  const cat = new Map(data.categories.map((c) => [c.id, c.name]));
  const header = ['Date', 'Account', 'Kind', 'Merchant', 'Category', 'Amount', 'Currency', 'Status', 'Notes', 'Source', 'Original description'];
  const rows = [...data.transactions]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt))
    .map((t) => {
      const a = acct.get(t.accountId);
      const category = t.splits?.length ? t.splits.map((s) => `${cat.get(s.categoryId) ?? ''} ${centsToDecimalString(s.amountCents)}`).join('; ') : t.categoryId ? (cat.get(t.categoryId) ?? '') : '';
      return [
        t.date, a?.name ?? '', t.kind, t.merchant, category, centsToDecimalString(t.amountCents), a?.currency ?? '', t.status,
        t.notes || t.adjustmentReason || '', t.provenance.source, t.provenance.rawDescription ?? '',
      ];
    });
  // Amounts like "-12.30" are numbers, not formulas: keep them unescaped so spreadsheets read them.
  return [header, ...rows].map((r) => r.map((v, i) => (i === 5 ? v : csvCell(v))).join(',')).join('\r\n') + '\r\n';
}
