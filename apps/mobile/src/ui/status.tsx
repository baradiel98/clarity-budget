import type { UpcomingItem } from '@clarity/engine';
import { INCOME_STATUS_LABEL, OCCURRENCE_STATUS_LABEL } from '@clarity/shared';
import { Badge } from './Card';

export function StatusBadge({ u }: { u: Pick<UpcomingItem, 'status' | 'isIncome'> }) {
  const label = (u.isIncome ? INCOME_STATUS_LABEL : OCCURRENCE_STATUS_LABEL)[u.status];
  const tone = u.status === 'overdue' ? (u.isIncome ? 'warn' : 'neg') : u.status === 'estimated' || u.status === 'unknown' ? 'warn' : u.status === 'confirmed' ? 'pos' : 'neutral';
  return <Badge label={label} tone={tone} />;
}
