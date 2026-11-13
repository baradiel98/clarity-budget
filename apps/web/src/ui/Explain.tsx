import type { Explanation } from '@clarity/engine';
import { formatShortDate } from '@clarity/shared';
import { TERMS } from '@clarity/shared';
import { Dialog } from './Dialog';
import { Money } from './Money';

/** "Why this number?" — renders the engine's own line items, never recomputes. */
export function ExplainDialog({ ex, currency, onClose }: { ex: Explanation; currency: string; onClose: () => void }) {
  return (
    <Dialog title={`${TERMS.whyThisNumber} · ${ex.title}`} onClose={onClose} variant="drawer" labelId="explain-title">
      <p className="t-callout muted" style={{ margin: 0 }}>{ex.summary}</p>
      <div className="explain-lines">
        {ex.lines.map((l, i) => (
          <div key={i} className={`explain-line ${l.kind}`}>
            <div>
              <div>{l.label}</div>
              {(l.date || l.note) && (
                <div className="note">
                  {l.date ? formatShortDate(l.date) : ''}
                  {l.date && l.note ? ' · ' : ''}
                  {l.note}
                </div>
              )}
            </div>
            <div className="num">
              {l.cents !== undefined ? <Money cents={l.cents} currency={currency} sign={l.kind === 'in' || l.kind === 'out' || l.kind === 'reserve' ? 'always' : 'auto'} /> : ''}
            </div>
          </div>
        ))}
      </div>
      <h3 className="t-headline" style={{ marginTop: 24 }}>Assumptions</h3>
      <ul className="assumptions">
        {ex.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </Dialog>
  );
}
