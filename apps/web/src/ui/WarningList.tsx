import { AlertTriangle, CircleAlert, Info } from 'lucide-react';
import type { Warning } from '@clarity/engine';
import { formatShortDate } from '@clarity/shared';
import { Money } from './Money';

const GROUPS: { severity: Warning['severity']; title: string }[] = [
  { severity: 'critical', title: 'Needs action' },
  { severity: 'warning', title: 'Check these' },
  { severity: 'info', title: 'For your information' },
];

/**
 * Every warning the engine returns (Phase 4A.4.2), grouped by severity. Nothing is capped here: each warning's
 * dated amounts (`items`) are listed in full, so no date or amount is hidden by a display limit.
 */
export function WarningList({ warnings, currency }: { warnings: readonly Warning[]; currency: string }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {GROUPS.map((g) => {
        const list = warnings.filter((w) => w.severity === g.severity);
        if (!list.length) return null;
        return (
          <div key={g.severity} data-testid={`warnings-${g.severity}`}>
            <h3 className="t-footnote muted" style={{ margin: '0 0 4px' }}>{g.title} ({list.length})</h3>
            {list.map((w) => (
              <div key={w.id} className="warning-row" data-testid="warning-item">
                {w.severity === 'critical' ? <span className="attention neg warn-ico"><CircleAlert size={18} className="neg" /></span> : w.severity === 'warning' ? <span className="attention warn-ico"><AlertTriangle size={18} className="warn" /></span> : <Info size={18} className="faint" />}
                <div>
                  <div className="t">{w.title}</div>
                  <div className="d">{w.detail}</div>
                  {w.items && w.items.length > 1 && (
                    <ul className="warning-items" aria-label={`All dates for: ${w.title}`}>
                      {w.items.map((x, i) => (
                        <li key={`${x.date}-${i}`}><span>{formatShortDate(x.date)}</span><span>{x.label}</span><span className={`num ${x.cents < 0 ? 'neg' : ''}`}><Money cents={x.cents} currency={x.currency ?? currency} /></span></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
