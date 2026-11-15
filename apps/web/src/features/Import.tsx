import { AlertTriangle, CheckCircle2, CopyCheck, FileUp, Link2, ListChecks, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { commitImport, describeImportResult, describeImportUndo, markTransactionPosted, isLinkChoice, matchDecision, matchOptionView, postedByMatchOf, returnRowText, undoImportBatch as undoImport, type ImportDecision } from '@clarity/data';
import {
  checkImportFile, dataRowCount, DATE_FORMATS, findMatchCandidates, headerSignature, MATCH_WINDOWS, NO_DATA_ROWS_MESSAGE, reconcilePreview, type ImportCandidate, type ImportPreview, type ImportSettings,
} from '@clarity/import';
import { formatShortDate, IMPORT_BUTTON, RETURN_ROW_BADGE, MATCH_CHOICE_TITLE, MATCH_NONE_LABEL, MATCH_SKIP_LABEL, MATCH_STALE_TITLE, MATCH_TAKEN, PENDING_MATCH_NOTE, PENDING_MATCH_TITLE, PENDING_MATCH_UNRELATED, TERMS, type ColumnMapping, type DateFormat, type DecimalSeparator, type SignConvention } from '@clarity/shared';
import { useRouter } from '../lib/router';
import { sha256Hex } from '../platform/files';
import { useData, useRun, useSession } from '../state/session';
import { Field } from '../ui/Field';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';
import { useToast } from '../ui/Toast';
import { AccountSelect, CategorySelect } from './AddTransaction';
import { ImportClient, type Analysis } from './importClient';
import { Spinner } from '../ui/Spinner';

type Stage = 'choose' | 'map' | 'review' | 'done';
interface Row extends ImportCandidate {
  editKind: ImportDecision['kind'];
  editCategory: string | null;
  otherAccountId: string;
  linkOccurrence: boolean;
  /** Phase 4A.5.12: for a row that could be an existing transaction: the id the user picked, 'none', or undecided. */
  matchChoice: string | null;
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
      // Column names but no rows: say so here instead of showing an empty preview.
      if (a.guess.hasHeader && dataRowCount(a.nonBlankRows, true) === 0) return setError(NO_DATA_ROWS_MESSAGE);
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
      setRows(p.candidates.map((c) => ({ ...c, editKind: c.looksLikeTransfer ? 'transfer' : c.kind, editCategory: c.categoryId, otherAccountId: '', linkOccurrence: !!c.occurrenceMatch, matchChoice: null })));
      setStage('review');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const included = rows.filter((r) => r.include);
  // Phase 4A.5.10: rows confirmed as the same transaction aren't added; their pending transaction counts as posted
  // Phase 4A.5.12: candidates are recomputed from the CURRENT data on every render (a status change elsewhere shows at
  // once); those listed when the review was built stay, so nothing disappears silently.
  const liveOf = (r: Row) => (account ? findMatchCandidates(r, account, data.transactions, { alsoIds: r.matchCandidates.map((m) => m.txId), accounts: data.accounts }) : []);
  // Phase 4A.5.17: a confirmed return adds the returned money, so it counts as a new row, not a link
  const linked = (r: Row) => isLinkChoice(r.matchChoice, liveOf(r));
  // Phase 4A.5.18: what a row confirmed as a returned card payment records (shown instead of type and category)
  const returnOf = (r: Row) => { const m = r.matchChoice ? liveOf(r).find((x) => x.txId === r.matchChoice && x.basis === 'return') : undefined; return m ? returnRowText(m, data) : null; };
  // Phase 4A.5.14: per leg; a confirmed transfer fee makes the linked leg's effect the statement amount
  const sameIds = included.filter(linked).map((r) => postedByMatchOf(r.matchChoice!, liveOf(r), r.amountCents));
  const recon = useMemo(() => (preview && account ? reconcilePreview(preview, included.filter((r) => !linked(r)), { account, transactions: data.transactions, postedByMatch: sameIds }) : null), [preview, included, account, data.transactions, JSON.stringify(sameIds)]);
  // a row linked to an existing transaction (e.g. an existing transfer) creates nothing, so it needs no other account
  const blocking = included.filter((r) => r.editKind === 'transfer' && !r.otherAccountId && (r.matchChoice === null || r.matchChoice === 'none'));
  // Phase 4A.5.9: pending items that could explain the statement difference (cleared at the bank, still pending here)
  const reconPending = recon && !recon.note && recon.differenceCents !== 0 ? [...new Map([...(recon.pendingMatches ?? []).flat(), ...(recon.pendingPartial ?? [])].map((t) => [t.id, t])).values()] : [];
  // a pending item that is a candidate of a row is resolved in that row only (one place to decide)
  const rowFor = (txId: string) => rows.find((r) => liveOf(r).some((m) => m.txId === txId));
  const [reconUnrelated, setReconUnrelated] = useState(false);

  const commit = async () => {
    if (!preview || !account || !file || !columns || !dateFormat || !analysis) return;
    setBusy(true);
    let batchId = '';
    const r = await run((ctx) => {
      const res = commitImport(ctx, {
        accountId: account.id, fileName: file.name, fileHash: file.hash, parserId: 'csv', headerSignature: headerSignature(analysis.guess.headers), delimiter: analysis.delimiter,
        settings: { hasHeader, columns, dateFormat, decimalSeparator: decimal, signConvention: sign },
        decisions: included.map((x) => ({ candidate: x, kind: x.editKind, categoryId: x.editKind === 'transfer' ? null : x.editCategory, merchant: x.merchant, ...(x.otherAccountId ? { otherAccountId: x.otherAccountId } : {}), linkOccurrence: x.linkOccurrence, ...(x.matchChoice !== null ? { match: matchDecision(x.matchChoice, liveOf(x)) } : {}) })),
        knownDuplicateIds: rows.flatMap((x) => (x.duplicate?.level === 'exact' ? [x.duplicate.txId] : [])),
        totalRows: rows.length + preview.errors.length, excludedCount: rows.length - included.length, duplicateCount: rows.filter((x) => x.duplicate).length, errorCount: preview.errors.length,
        reconciliation: recon, applyAdjustment: applyAdj && (reconPending.length === 0 || reconUnrelated), adjustmentUnrelatedToPending: reconUnrelated,
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
  const dataRows = analysis ? dataRowCount(analysis.nonBlankRows, hasHeader) : 0;
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
              {busy ? <><Spinner /> Reading…</> : <><Upload size={15} /> Choose file</>}
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
            {dataRows === 0 ? <span className="hint neg" role="alert">{NO_DATA_ROWS_MESSAGE}</span> : <span className="hint">{dataRows} {dataRows === 1 ? 'row' : 'rows'} to read</span>}
            <button className="btn btn-primary" disabled={!columns || !dateFormat || busy || dataRows === 0} onClick={() => void toReview()} data-testid="to-review" aria-busy={busy}>{busy ? <><Spinner /> Reading…</> : 'Review transactions'}</button>
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
              <button className="btn btn-ghost btn-sm" onClick={() => setRows(rows.map((r) => ({ ...r, include: !(r.editKind === 'transfer' && !r.otherAccountId && !r.matchChoice) && !(liveOf(r).length && !r.matchChoice) })))}>Select all</button>
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
                      <td className="w-check"><input type="checkbox" aria-label={`Import row ${r.rowNumber}`} checked={r.include} disabled={liveOf(r).length > 0} title={liveOf(r).length ? 'Choose below which transaction this is, or that it is a different one' : undefined} onChange={(e) => setRow(i, { include: e.target.checked })} /></td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatShortDate(r.date)}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{r.merchant || <span className="faint">No description</span>}</div>
                        {r.rawDescription !== r.merchant && <div className="hint">{r.rawDescription}</div>}
                      </td>
                      {/* Phase 4A.5.18: a row confirmed as a returned card payment has no type or category to choose */}
                      {returnOf(r) ? (
                        <td colSpan={2} data-testid={`return-kind-${r.rowNumber}`}>
                          <span className="badge accent">{RETURN_ROW_BADGE}</span>
                          <div className="hint" style={{ marginTop: 4 }}>{returnOf(r)}</div>
                        </td>
                      ) : (<>
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
                      </>)}
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
                        {liveOf(r).length > 0 && (() => {
                          const live = liveOf(r);
                          const views = live.map((m) => matchOptionView(m, r.amountCents, data, cur));
                          const chosen = views.find((v) => v.txId === r.matchChoice);
                          const option = (v: typeof views[number]) => {
                            // Phase 4A.5.17: a link and a return of the same payment can be in one statement; two of the same kind can't
                        const taken = rows.find((o) => o !== r && o.include && o.matchChoice === v.txId && (liveOf(o).find((m) => m.txId === v.txId)?.basis === 'return') === v.isReturn);
                            return (
                              <label key={v.txId} className="check" style={{ fontSize: 12.5 }}>
                                <input type="radio" name={`match-${r.rowNumber}`} checked={r.matchChoice === v.txId} disabled={!!taken || !!v.disabledReason} onChange={() => setRow(i, { matchChoice: v.txId, include: true })} />
                                <span>{v.label}{taken ? ` (${MATCH_TAKEN(taken.rowNumber)})` : ''}{v.disabledReason && <span className="hint warn" style={{ display: 'block' }}>{v.disabledReason}</span>}</span>
                              </label>
                            );
                          };
                          return (
                            <div role="radiogroup" aria-label={`Row ${r.rowNumber}: ${MATCH_CHOICE_TITLE}`} className="stack" style={{ gap: 2, marginTop: 6 }} data-testid={`match-choice-${r.rowNumber}`}>
                              <strong style={{ fontSize: 12.5 }}>{MATCH_CHOICE_TITLE}</strong>
                              {views.filter((v) => !v.stale).map(option)}
                              {views.some((v) => v.stale) && <div className="hint warn" style={{ marginTop: 4 }} data-testid={`match-stale-${r.rowNumber}`}>{MATCH_STALE_TITLE(MATCH_WINDOWS.pending.daysAfter)}</div>}
                              {views.filter((v) => v.stale).map(option)}
                              <label className="check" style={{ fontSize: 12.5 }}><input type="radio" name={`match-${r.rowNumber}`} checked={r.matchChoice === 'none'} onChange={() => setRow(i, { matchChoice: 'none', include: true })} /><span>{MATCH_NONE_LABEL(live.length)}</span></label>
                              <label className="check" style={{ fontSize: 12.5 }}><input type="radio" name={`match-${r.rowNumber}`} checked={r.matchChoice === null} onChange={() => setRow(i, { matchChoice: null, include: false })} /><span>{MATCH_SKIP_LABEL}</span></label>
                              {chosen && <div className="hint" data-testid={`match-note-${r.rowNumber}`}>{chosen.note}</div>}
                            </div>
                          );
                        })()}
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
                    <div><div className="k">Clarity's posted balance after this import</div><div className="v"><Money cents={recon.appBalanceCents} currency={cur} /></div></div>
                    <div><div className="k">Difference</div><div className={`v ${recon.differenceCents ? 'warn' : 'pos'}`}>{recon.differenceCents === 0 ? <><CheckCircle2 size={14} /> Matches</> : <Money cents={recon.differenceCents} currency={cur} sign="always" />}</div></div>
                  </div>
                  {recon.runningBalanceConsistent === false && <p className="t-footnote warn">The file's running balance doesn't agree with its amounts. Check the “money out” setting.</p>}
                  <p className="t-footnote muted">Like the statement, this leaves out items still pending in Clarity.</p>
                  {reconPending.length > 0 && (
                    <div className="callout warn" data-testid="import-pending-match" role="alert">
                      <strong>{PENDING_MATCH_TITLE}</strong>
                      <div className="hint">{PENDING_MATCH_NOTE}</div>
                      <ul className="warning-items with-action">
                        {reconPending.map((t) => (
                          <li key={t.id}>
                            <span>{formatShortDate(t.date)}</span>
                            <span>{t.merchant || 'Pending'} · {t.kind} · pending</span>
                            <span className="num"><Money cents={t.amountCents} currency={cur} sign="always" /></span>
                            {rowFor(t.id) ? <span className="hint">resolve it in row {rowFor(t.id)!.rowNumber} above</span> : <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run((ctx) => markTransactionPosted(ctx, t.id), { undoLabel: 'Marked posted' })} aria-label={`Mark ${t.merchant || 'pending item'} posted`}>Mark posted</button>}
                          </li>
                        ))}
                      </ul>
                      <label className="check"><input type="checkbox" checked={reconUnrelated} onChange={(e) => setReconUnrelated(e.target.checked)} data-testid="import-pending-unrelated" /><span>{PENDING_MATCH_UNRELATED}</span></label>
                    </div>
                  )}
                  {recon.differenceCents !== 0 && (
                    <label className="check" style={{ marginTop: 12 }}>
                      <input type="checkbox" checked={applyAdj && (reconPending.length === 0 || reconUnrelated)} disabled={reconPending.length > 0 && !reconUnrelated} onChange={(e) => setApplyAdj(e.target.checked)} />
                      <span>Record a balance adjustment of <Money cents={recon.differenceCents} currency={cur} sign="always" /> so this account matches the statement. <span className="hint">Usually caused by transactions from before you started using Clarity, or rows you excluded.</span></span>
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {blocking.length > 0 && <span className="t-footnote warn">Choose the other account for {blocking.length} transfer{blocking.length > 1 ? 's' : ''}.</span>}
            <button className="btn btn-primary btn-lg" disabled={busy || included.length === 0 || blocking.length > 0} onClick={() => void commit()} data-testid="commit-import" aria-busy={busy}>
              {busy && <Spinner />}{IMPORT_BUTTON(included.filter((r) => !linked(r) && !returnOf(r)).length, included.filter(linked).length, included.filter((r) => !!returnOf(r)).length)}
            </button>
          </div>
        </div>
      )}

      {stage === 'done' && result && (
        <div className="card empty" data-testid="import-done">
          <div className="ico" style={{ background: 'var(--c-positive-soft)', color: 'var(--c-positive)' }}><CheckCircle2 size={26} /></div>
          <div className="t-title2">Import complete</div>
          {(() => { const b = data.importBatches.find((x) => x.id === result.batchId); return b ? <div className="t-callout" data-testid="import-result">{describeImportResult(b)}</div> : null; })()}
          <div className="t-callout">Your balances and forecast are updated. The statement file was not kept.</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={async () => { const msg = describeImportUndo(data, result.batchId); const r = await run((ctx) => undoImport(ctx, result.batchId)); if (r.ok) { toast({ message: msg }); setStage('choose'); } else toast({ message: r.errors.map((e) => e.message).join(' ') }); }}>Undo import</button>
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
              <div className="hint">{new Date(b.importedAt).toLocaleString()} · {data.accounts.find((a) => a.id === b.accountId)?.name} · {describeImportResult(b)} · {b.counts.excluded} excluded, {b.counts.errors} unreadable</div>
            </div>
            {!b.undoneAt && <button className="btn btn-secondary btn-sm" onClick={async () => { const msg = describeImportUndo(data, b.id); const r = await run((ctx) => undoImport(ctx, b.id)); toast({ message: r.ok ? msg : r.errors.map((e) => e.message).join(' ') }); }}>Undo</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
