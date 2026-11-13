import { AlertTriangle, CheckCircle2, CopyCheck, FileUp, Link2, ListChecks, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { commitImport, undoImportBatch as undoImport, type ImportDecision } from '@clarity/data';
import {
  checkImportFile, DATE_FORMATS, headerSignature, reconcilePreview, type ImportCandidate, type ImportPreview, type ImportSettings,
} from '@clarity/import';
import { formatShortDate, TERMS, type ColumnMapping, type DateFormat, type DecimalSeparator, type SignConvention } from '@clarity/shared';
import { useRouter } from '../lib/router';
import { sha256Hex } from '../platform/files';
import { useData, useRun, useSession } from '../state/session';
import { Field } from '../ui/Field';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';
import { useToast } from '../ui/Toast';
import { AccountSelect, CategorySelect } from './AddTransaction';
import { ImportClient, type Analysis } from './importClient';

type Stage = 'choose' | 'map' | 'review' | 'done';
interface Row extends ImportCandidate {
  editKind: ImportDecision['kind'];
  editCategory: string | null;
  otherAccountId: string;
  linkOccurrence: boolean;
}

export function ImportPage() {
  const data = useData();
  const { today } = useSession();
  const run = useRun();
  const toast = useToast();
  const { navigate } = useRouter();
  const cur = data.settings.baseCurrency;
  const client = useRef<ImportClient | null>(null);
  useEffect(() => {
    client.current = new ImportClient();
    return () => client.current?.dispose();
  }, []);

  const [stage, setStage] = useState<Stage>('choose');
  const [accountId, setAccountId] = useState(data.settings.defaultAccountId ?? data.accounts.find((a) => !a.archived)?.id ?? '');
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [columns, setColumns] = useState<ColumnMapping | null>(null);
  const [dateFormat, setDateFormat] = useState<DateFormat | ''>('');
  const [decimal, setDecimal] = useState<DecimalSeparator>('.');
  const [sign, setSign] = useState<SignConvention>('as_is');
  const [signReason, setSignReason] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [applyAdj, setApplyAdj] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [result, setResult] = useState<{ batchId: string; count: number } | null>(null);
  const [profileUsed, setProfileUsed] = useState(false);

  const account = data.accounts.find((a) => a.id === accountId);

  const onFile = async (f: File) => {
    setError(null);
    const head = await f.slice(0, 4096).text();
    const check = checkImportFile(f.name, f.size, head);
    if (!check.ok) return setError(check.reason);
    setBusy(true);
    try {
      const text = await f.text();
      const [hash, a] = await Promise.all([sha256Hex(text), client.current!.analyze(text)]);
      setFile({ name: f.name, hash });
      setAnalysis(a);
      const sig = headerSignature(a.guess.headers);
      const profile = a.guess.hasHeader ? data.mappingProfiles.find((p) => p.headerSignature === sig) : undefined;
      if (profile) {
        setHasHeader(profile.hasHeader);
        setColumns(profile.columns);
        setDateFormat(profile.dateFormat);
        setDecimal(profile.decimalSeparator);
        setSign(profile.signConvention);
        setSignReason('Using the settings you confirmed last time for this bank’s format.');
        setProfileUsed(true);
      } else {
        setHasHeader(a.guess.hasHeader);
        setColumns(a.guess.columns);
        setDateFormat(a.guess.dateFormats.length === 1 ? a.guess.dateFormats[0]! : '');
        setDecimal(a.guess.decimalSeparator);
        setProfileUsed(false);
        if (a.guess.columns && a.guess.dateFormats[0] && account) {
          const s = await client.current!.suggestSign({ hasHeader: a.guess.hasHeader, columns: a.guess.columns, dateFormat: a.guess.dateFormats[0], decimalSeparator: a.guess.decimalSeparator }, account);
          setSign(s.convention);
          setSignReason(s.reason);
        }
      }
      setStage('map');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toReview = async () => {
    if (!columns || !dateFormat || !account || !file) return;
    setBusy(true);
    setError(null);
    try {
      const settings: ImportSettings = { hasHeader, columns, dateFormat, decimalSeparator: decimal, signConvention: sign };
      const p = await client.current!.preview(settings, {
        account, accounts: data.accounts, transactions: data.transactions, recurring: data.recurring, exceptions: data.exceptions,
        importBatches: data.importBatches, fileHash: file.hash, today,
      });
      setPreview(p);
      setRows(p.candidates.map((c) => ({ ...c, editKind: c.looksLikeTransfer ? 'transfer' : c.kind, editCategory: c.categoryId, otherAccountId: '', linkOccurrence: !!c.occurrenceMatch })));
      setStage('review');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const included = rows.filter((r) => r.include);
  const recon = useMemo(() => (preview && account ? reconcilePreview(preview, included, { account, transactions: data.transactions }) : null), [preview, included, account, data.transactions]);
  const blocking = included.filter((r) => r.editKind === 'transfer' && !r.otherAccountId);

  const commit = async () => {
    if (!preview || !account || !file || !columns || !dateFormat || !analysis) return;
    setBusy(true);
    let batchId = '';
    const r = await run((ctx) => {
      const res = commitImport(ctx, {
        accountId: account.id, fileName: file.name, fileHash: file.hash, parserId: 'csv', headerSignature: headerSignature(analysis.guess.headers), delimiter: analysis.delimiter,
        settings: { hasHeader, columns, dateFormat, decimalSeparator: decimal, signConvention: sign },
        decisions: included.map((x) => ({ candidate: x, kind: x.editKind, categoryId: x.editKind === 'transfer' ? null : x.editCategory, merchant: x.merchant, ...(x.otherAccountId ? { otherAccountId: x.otherAccountId } : {}), linkOccurrence: x.linkOccurrence })),
        totalRows: rows.length + preview.errors.length, excludedCount: rows.length - included.length, duplicateCount: rows.filter((x) => x.duplicate).length, errorCount: preview.errors.length,
        reconciliation: recon, applyAdjustment: applyAdj,
      });
      batchId = res.batch.id;
      return res.ops;
    });
    setBusy(false);
    if (!r.ok) return setError(r.errors.map((e) => e.message).join(' '));
    setResult({ batchId, count: included.length });
    setStage('done');
  };

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const colOptions = analysis ? (hasHeader ? analysis.guess.headers : analysis.guess.headers.map((_, i) => `Column ${i + 1}`)) : [];
  const ColSelect = ({ label, value, onChange, optional }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; optional?: boolean }) => (
    <Field label={label}>
      {(id) => (
        <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
          {optional && <option value="">None</option>}
          {!optional && value === undefined && <option value="">Choose…</option>}
          {colOptions.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
        </select>
      )}
    </Field>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{TERMS.importStatement}</h1>
          <div className="sub muted t-callout">Bring in a statement from your bank instead of typing every transaction.</div>
        </div>
        {stage !== 'choose' && stage !== 'done' && <button className="btn btn-ghost" onClick={() => { setStage('choose'); setPreview(null); setAnalysis(null); }}>Start over</button>}
      </div>

      <ol className="stepper" aria-label="Import steps">
        {(['choose', 'map', 'review', 'done'] as Stage[]).map((st, i) => {
          const at = ['choose', 'map', 'review', 'done'].indexOf(stage);
          return <li key={st} className={`step ${i === at ? 'on' : i < at ? 'done' : ''}`} aria-current={i === at ? 'step' : undefined}><span>{['Choose a statement', 'Check how it is read', 'Review transactions', 'Done'][i]}</span></li>;
        })}
      </ol>

      {error && <div className="callout neg" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {stage === 'choose' && (
        <div className="card stack">
          <Field label="Import into account">{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}
          >
            <div className="ico"><FileUp size={22} /></div>
            <p className="t-headline">Drop a CSV statement here</p>
            <p className="t-callout muted">Download it from your bank's website (often under “Download transactions” or “Export”). Up to 10 MB.</p>
            <label className="btn btn-primary" style={{ marginTop: 8 }}>
              <Upload size={15} /> {busy ? 'Reading…' : 'Choose file'}
              <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} data-testid="import-file" />
            </label>
            <p className="hint" style={{ marginTop: 14 }}>PDF, OFX/QFX and Excel statements are not supported yet.</p>
          </div>
          <div className="assure">
            <div><ShieldCheck size={16} /><span><strong>Stays on this device.</strong> The file is read here and never uploaded.</span></div>
            <div><ListChecks size={16} /><span><strong>You approve every row.</strong> Nothing is saved until you review it.</span></div>
            <div><CopyCheck size={16} /><span><strong>Duplicates are flagged.</strong> Never assumed from the amount alone.</span></div>
          </div>
          <ImportHistory />
        </div>
      )}

      {stage === 'map' && analysis && (
        <div className="stack">
          <div className="card stack">
            <div className="row between">
              <h2 className="t-headline">Check how the file is read</h2>
              {profileUsed && <span className="badge accent">Saved settings applied</span>}
            </div>
            <label className="check"><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> The first row contains column names</label>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <ColSelect label="Date" value={columns?.date} onChange={(v) => setColumns({ ...(columns ?? { description: 0 }), date: v ?? 0 } as ColumnMapping)} />
              <ColSelect label="Description" value={columns?.description} onChange={(v) => setColumns({ ...(columns ?? { date: 0 }), description: v ?? 0 } as ColumnMapping)} />
              <Field label="Amounts are in">
                {(id) => (
                  <select id={id} className="select" value={columns?.amount !== undefined ? 'single' : 'split'} onChange={(e) => {
                    const c = { ...(columns ?? { date: 0, description: 1 }) };
                    if (e.target.value === 'single') { delete c.debit; delete c.credit; c.amount = c.amount ?? 2; } else { delete c.amount; c.debit = c.debit ?? 2; c.credit = c.credit ?? 3; }
                    setColumns(c as ColumnMapping);
                  }}>
                    <option value="single">One column (signed)</option>
                    <option value="split">Separate debit and credit columns</option>
                  </select>
                )}
              </Field>
              {columns?.amount !== undefined ? (
                <ColSelect label="Amount" value={columns.amount} onChange={(v) => setColumns({ ...columns, amount: v ?? 0 })} />
              ) : (
                <>
                  <ColSelect label="Debit (money out)" value={columns?.debit} onChange={(v) => setColumns({ ...columns!, debit: v ?? 0 })} />
                  <ColSelect label="Credit (money in)" value={columns?.credit} onChange={(v) => setColumns({ ...columns!, credit: v ?? 0 })} />
                </>
              )}
              <ColSelect label="Running balance" optional value={columns?.balance} onChange={(v) => { const c = { ...columns! }; if (v === undefined) delete c.balance; else c.balance = v; setColumns(c); }} />
              <ColSelect label="Transaction ID" optional value={columns?.externalId} onChange={(v) => { const c = { ...columns! }; if (v === undefined) delete c.externalId; else c.externalId = v; setColumns(c); }} />
              <Field label="Date format" error={!dateFormat ? (analysis.guess.dateFormats.length > 1 ? 'These dates could be read two ways. Choose the format your bank uses.' : 'Choose the date format.') : null}>
                {(id) => (
                  <select id={id} className="select" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)} data-testid="date-format">
                    <option value="">Choose…</option>
                    {(analysis.guess.dateFormats.length ? analysis.guess.dateFormats : DATE_FORMATS).map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Decimal separator">
                {(id) => (
                  <select id={id} className="select" value={decimal} onChange={(e) => setDecimal(e.target.value as DecimalSeparator)}>
                    <option value=".">Point (1,234.56)</option>
                    <option value=",">Comma (1.234,56)</option>
                  </select>
                )}
              </Field>
              <Field label="Money out appears as" hint={signReason}>
                {() => <Segmented label="Sign convention" value={sign} onChange={(v) => { setSign(v); setSignReason(''); }} options={[{ value: 'as_is', label: 'Negative' }, { value: 'invert', label: 'Positive' }]} />}
              </Field>
            </div>
          </div>
          <div className="card flush">
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="data">
                <thead><tr>{colOptions.map((h, i) => <th key={i}>{h || `Column ${i + 1}`}</th>)}</tr></thead>
                <tbody>{analysis.sample.slice(hasHeader ? 1 : 0, 9).map((r, i) => <tr key={i}>{colOptions.map((_, j) => <td key={j} className="t-footnote">{r[j]}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <span className="hint">{analysis.rowCount} lines in file</span>
            <button className="btn btn-primary" disabled={!columns || !dateFormat || busy} onClick={() => void toReview()} data-testid="to-review">{busy ? 'Reading…' : 'Review transactions'}</button>
          </div>
        </div>
      )}

      {stage === 'review' && preview && (
        <div className="stack">
          {preview.fileAlreadyImported && (
            <div className="callout warn" role="alert"><AlertTriangle size={14} /> This file was already imported on {new Date(preview.fileAlreadyImported.importedAt).toLocaleDateString()}. Matching rows are excluded.</div>
          )}
          {preview.truncated && <div className="callout warn">Only the first 20,000 rows were read.</div>}
          <div className="card">
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="badge accent" data-testid="import-count">{included.length} selected</span>
              <span className="badge">{rows.length} rows read</span>
              {rows.some((r) => r.duplicate) && <span className="badge warn">{rows.filter((r) => r.duplicate).length} possible duplicates</span>}
              {rows.some((r) => r.confidence !== 'high') && <span className="badge warn">{rows.filter((r) => r.confidence !== 'high').length} to check</span>}
              {preview.errors.length > 0 && <span className="badge neg">{preview.errors.length} could not be read</span>}
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => setRows(rows.map((r) => ({ ...r, include: !(r.editKind === 'transfer' && !r.otherAccountId) })))}>Select all</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRows(rows.map((r) => ({ ...r, include: false })))}>Select none</button>
            </div>
          </div>

          <div className="card flush">
            <div className="table-wrap" style={{ maxHeight: 560 }}>
              <table className="data" data-testid="review-table">
                <thead>
                  <tr><th className="w-check" /><th>Date</th><th>Description</th><th>Type</th><th>Category / account</th><th>Notes</th><th className="right">Amount</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.rowNumber} className={r.include ? '' : 'excluded'}>
                      <td className="w-check"><input type="checkbox" aria-label={`Import row ${r.rowNumber}`} checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} /></td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatShortDate(r.date)}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{r.merchant || <span className="faint">No description</span>}</div>
                        {r.rawDescription !== r.merchant && <div className="hint">{r.rawDescription}</div>}
                      </td>
                      <td>
                        <select className="select" style={{ height: 32, width: 120 }} value={r.editKind} aria-label="Type" onChange={(e) => setRow(i, { editKind: e.target.value as Row['editKind'] })}>
                          {r.amountCents < 0 ? <option value="expense">Expense</option> : <><option value="income">Income</option><option value="refund">Refund</option></>}
                          <option value="transfer">Transfer</option>
                        </select>
                      </td>
                      <td style={{ minWidth: 190 }}>
                        {r.editKind === 'transfer' ? (
                          <select className="select" style={{ height: 32 }} value={r.otherAccountId} aria-label="Other account" onChange={(e) => setRow(i, { otherAccountId: e.target.value, include: !!e.target.value })}>
                            <option value="">{r.amountCents < 0 ? 'To which account?' : 'From which account?'}</option>
                            {data.accounts.filter((a) => !a.archived && a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        ) : (
                          <div style={{ height: 32 }}><CategorySelect value={r.editCategory} onChange={(v) => setRow(i, { editCategory: v })} kind={r.editKind === 'income' ? 'income' : 'expense'} /></div>
                        )}
                      </td>
                      <td style={{ maxWidth: 260 }}>
                        <div className="row wrap" style={{ gap: 4 }}>
                          {r.duplicate && <span className={`badge ${r.duplicate.level === 'exact' ? 'neg' : 'warn'}`} title={r.duplicate.reason}>{r.duplicate.level === 'exact' ? 'Already imported' : 'Possible duplicate'}</span>}
                          {r.confidence === 'low' && <span className="badge neg">Check</span>}
                          {r.repeatInFile && <span className="badge" title="The same amount, date and description appears more than once in this file. Both are kept.">Repeated</span>}
                          {r.occurrenceMatch && (
                            <label className="badge accent" style={{ cursor: 'pointer' }} title="Links this row to the scheduled item so it isn't counted twice in your forecast">
                              <input type="checkbox" checked={r.linkOccurrence} onChange={(e) => setRow(i, { linkOccurrence: e.target.checked })} style={{ width: 12, height: 12, margin: 0 }} />
                              <Link2 size={11} /> {r.occurrenceMatch.name}
                            </label>
                          )}
                        </div>
                        {(r.duplicate || r.reasons.length > 0) && <div className="hint" style={{ marginTop: 4 }}>{[r.duplicate?.reason, ...r.reasons].filter(Boolean).join(' ')}</div>}
                      </td>
                      <td className={`right num ${r.amountCents > 0 ? 'pos' : ''}`} style={{ fontWeight: 600 }}><Money cents={r.amountCents} currency={cur} sign="always" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {preview.errors.length > 0 && (
            <details className="card">
              <summary className="t-headline" style={{ cursor: 'pointer' }}>{preview.errors.length} rows could not be read (not imported)</summary>
              <div className="list" style={{ marginTop: 10 }}>
                {preview.errors.map((e) => <div key={e.rowNumber} className="kv"><span className="t-footnote">Line {e.rowNumber}: <span className="faint">{e.raw}</span></span><span className="t-footnote neg">{e.reason}</span></div>)}
              </div>
            </details>
          )}

          {recon && (
            <div className="card" data-testid="reconciliation">
              <h2 className="t-headline">Balance check</h2>
              {recon.note ? <p className="t-callout muted">{recon.note}</p> : (
                <>
                  <div className="facts" style={{ borderTop: 0, marginTop: 8, paddingTop: 0 }}>
                    <div><div className="k">Statement balance on {formatShortDate(recon.statementDate)}</div><div className="v"><Money cents={recon.statementBalanceCents} currency={cur} /></div></div>
                    <div><div className="k">Clarity after this import</div><div className="v"><Money cents={recon.appBalanceCents} currency={cur} /></div></div>
                    <div><div className="k">Difference</div><div className={`v ${recon.differenceCents ? 'warn' : 'pos'}`}>{recon.differenceCents === 0 ? <><CheckCircle2 size={14} /> Matches</> : <Money cents={recon.differenceCents} currency={cur} sign="always" />}</div></div>
                  </div>
                  {recon.runningBalanceConsistent === false && <p className="t-footnote warn">The file's running balance doesn't agree with its amounts. Check the “money out” setting.</p>}
                  {recon.differenceCents !== 0 && (
                    <label className="check" style={{ marginTop: 12 }}>
                      <input type="checkbox" checked={applyAdj} onChange={(e) => setApplyAdj(e.target.checked)} />
                      <span>Record a balance adjustment of <Money cents={recon.differenceCents} currency={cur} sign="always" /> so this account matches the statement. <span className="hint">Usually caused by transactions from before you started using Clarity, or rows you excluded.</span></span>
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {blocking.length > 0 && <span className="t-footnote warn">Choose the other account for {blocking.length} transfer{blocking.length > 1 ? 's' : ''}.</span>}
            <button className="btn btn-primary btn-lg" disabled={busy || included.length === 0 || blocking.length > 0} onClick={() => void commit()} data-testid="commit-import">
              Import {included.length} transaction{included.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      {stage === 'done' && result && (
        <div className="card empty" data-testid="import-done">
          <div className="ico" style={{ background: 'var(--c-positive-soft)', color: 'var(--c-positive)' }}><CheckCircle2 size={26} /></div>
          <div className="t-title2">Imported {result.count} transaction{result.count === 1 ? '' : 's'}</div>
          <div className="t-callout">Your balances and forecast are updated. The statement file was not kept.</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={async () => { const r = await run((ctx) => undoImport(ctx, result.batchId)); if (r.ok) { toast({ message: 'Import undone' }); setStage('choose'); } }}>Undo import</button>
            <button className="btn btn-primary" onClick={() => navigate('/transactions')}>View transactions</button>
          </div>
        </div>
      )}
    </div>
  );
}


export function ImportHistory() {
  const data = useData();
  const run = useRun();
  const toast = useToast();
  const batches = [...data.importBatches].sort((a, b) => b.importedAt - a.importedAt);
  if (batches.length === 0) return null;
  return (
    <div>
      <h3 className="t-headline" style={{ marginTop: 8 }}>Import history</h3>
      <div className="list">
        {batches.map((b) => (
          <div key={b.id} className="kv">
            <div>
              <div className="t-callout" style={{ fontWeight: 500 }}>{b.fileName} {b.undoneAt && <span className="badge">Undone</span>}</div>
              <div className="hint">{new Date(b.importedAt).toLocaleString()} · {data.accounts.find((a) => a.id === b.accountId)?.name} · {b.counts.imported} imported, {b.counts.excluded} excluded, {b.counts.errors} unreadable</div>
            </div>
            {!b.undoneAt && <button className="btn btn-secondary btn-sm" onClick={async () => { const r = await run((ctx) => undoImport(ctx, b.id)); toast({ message: r.ok ? `Removed transactions from ${b.fileName}` : 'Could not undo' }); }}>Undo</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
