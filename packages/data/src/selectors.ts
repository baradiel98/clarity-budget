import type { ISODate, WorkspaceData } from '@clarity/shared';
import type { EngineInput } from '@clarity/engine';

export function engineInput(data: WorkspaceData, today: ISODate): EngineInput {
  return {
    today,
    accounts: data.accounts,
    transactions: data.transactions,
    recurring: data.recurring,
    exceptions: data.exceptions,
    baseCurrency: data.settings.baseCurrency,
    minReserveCents: data.settings.minReserveCents,
  };
}

export function backupDue(data: WorkspaceData, now: number): { due: boolean; reason: string | null } {
  const s = data.settings;
  if (data.transactions.length === 0) return { due: false, reason: null };
  if (s.lastBackupAt === null) return { due: true, reason: 'You have not made a backup yet.' };
  const days = Math.floor((now - s.lastBackupAt) / 86_400_000);
  if (days >= s.backupReminderDays) return { due: true, reason: `Your last backup was ${days} days ago.` };
  if (s.txSinceBackup >= s.backupReminderTxCount) return { due: true, reason: `${s.txSinceBackup} changes since your last backup.` };
  return { due: false, reason: null };
}
