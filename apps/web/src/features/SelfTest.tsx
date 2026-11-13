import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { runEngineSelfTest } from '@clarity/engine';
import { runCryptoSelfTest, type SelfTestResult } from '@clarity/security';
import { provider } from '../platform/crypto';

/** Diagnostics: recompute the golden scenarios and crypto vectors in this browser. */
export function SelfTest() {
  const [engine] = useState(() => runEngineSelfTest());
  const [crypto, setCrypto] = useState<SelfTestResult[] | null>(null);
  useEffect(() => {
    void runCryptoSelfTest(provider, () => performance.now()).then(setCrypto);
  }, []);
  const all = [...engine.map((e) => ({ name: `Engine: ${e.name}`, ok: e.ok, detail: e.detail })), ...(crypto ?? []).map((c) => ({ name: `Crypto: ${c.name}`, ok: c.ok, detail: c.ok ? `${Math.round(c.ms)} ms` : c.detail }))];
  const passed = crypto && all.every((r) => r.ok);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="t-title1">Self-test</h1>
          <div className="sub muted t-callout">{navigator.userAgent}</div>
        </div>
      </div>
      <div className="card">
        <div className={`row ${passed ? 'pos' : crypto ? 'neg' : 'muted'}`} style={{ fontWeight: 600, marginBottom: 8 }} data-testid="selftest-status">
          {!crypto ? 'Running…' : passed ? <><CheckCircle2 size={18} /> All checks passed</> : <><CircleAlert size={18} /> Some checks failed</>}
        </div>
        <div className="list">
          {all.map((r) => (
            <div key={r.name} className="kv">
              <span>{r.name}</span>
              <span className={`badge ${r.ok ? 'pos' : 'neg'}`}>{r.ok ? 'Pass' : 'Fail'}{r.detail ? ` · ${r.detail}` : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
