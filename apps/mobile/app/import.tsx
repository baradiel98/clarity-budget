import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import * as ExpoCrypto from 'expo-crypto';
import { commitImport, undoImportBatch, type ImportDecision } from '@clarity/data';
import {
  buildPreview, checkImportFile, csvParser, guessMapping, headerSignature, reconcilePreview, suggestSignConvention, type ImportCandidate, type ImportPreview,
  type MappingGuess, type RawTable,
} from '@clarity/import';
import { formatCents, formatShortDate, TERMS, type DateFormat, type DecimalSeparator, type SignConvention } from '@clarity/shared';
import { Check } from '../src/features/Welcome';
import { pickTextFile } from '../src/platform/files';
import { useData, useRun, useSession } from '../src/state/session';
import { Button } from '../src/ui/Button';
import { Badge, Card } from '../src/ui/Card';
import { Field } from '../src/ui/Field';
import { Money } from '../src/ui/Money';
import { Segmented } from '../src/ui/Segmented';
import { SubScreen } from '../src/ui/SubScreen';
import { T } from '../src/ui/Text';
import { useTheme } from '../src/ui/theme';
import { useToast } from '../src/ui/Toast';
import { Chip } from './add';

interface Row extends ImportCandidate {
  editKind: ImportDecision['kind'];
  editCategory: string | null;
  otherAccountId: string;
  linkOccurrence: boolean;
  expanded: boolean;
}

export default function ImportScreen() {
  const data = useData();
  const { today } = useSession();
  const run = useRun();
  const toast = useToast();
  const { c } = useTheme();
  const cur = data.settings.baseCurrency;
  const [stage, setStage] = useState<'choose' | 'map' | 'review' | 'done'>('choose');
  const [accountId, setAccountId] = useState(data.settings.defaultAccountId ?? data.accounts.find((a) => !a.archived)?.id ?? '');
  const [file, setFile] = useState<{ name: string; hash: string; table: RawTable; guess: MappingGuess } | null>(null);
  const [dateFormat, setDateFormat] = useState<DateFormat | ''>('');
  const [decimal, setDecimal] = useState<DecimalSeparator>('.');
  const [sign, setSign] = useState<SignConvention>('as_is');
  const [signReason, setSignReason] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [applyAdj, setApplyAdj] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const account = data.accounts.find((a) => a.id === accountId);

  const choose = async () => {
    setError(null);
    const f = await pickTextFile(['text/csv', 'text/comma-separated-values', 'text/plain', 'application/csv', 'application/vnd.ms-excel', '*/*']);
    if (!f) return;
    const check = checkImportFile(f.name, f.size || f.text.length, f.text.slice(0, 4096));
    if (!check.ok) return setError(check.reason);
    setBusy(true);
    setTimeout(async () => {
      try {
        const table = csvParser.parse(f.text);
        const guess = guessMapping(table);
        if (!guess.columns) throw new Error(guess.problems.join(' ') || 'Could not read the columns in this file.');
        const hash = await ExpoCrypto.digestStringAsync(ExpoCrypto.CryptoDigestAlgorithm.SHA256, f.text);
        const profile = guess.hasHeader ? data.mappingProfiles.find((p) => p.headerSignature === headerSignature(guess.headers)) : undefined;
        if (profile) {
          setDateFormat(profile.dateFormat);
          setDecimal(profile.decimalSeparator);
          setSign(profile.signConvention);
          setSignReason('Using the settings you confirmed last time for this format.');
        } else {
          setDateFormat(guess.dateFormats.length === 1 ? guess.dateFormats[0]! : '');
          setDecimal(guess.decimalSeparator);
          if (guess.dateFormats[0] && account) {
            const sg = suggestSignConvention(table, { hasHeader: guess.hasHeader, columns: guess.columns, dateFormat: guess.dateFormats[0], decimalSeparator: guess.decimalSeparator }, account);
            setSign(sg.convention);
            setSignReason(sg.reason);
          }
        }
        setFile({ name: f.name, hash, table, guess });
        setStage('map');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 10);
  };

  const review = () => {
    if (!file || !dateFormat || !account || !file.guess.columns) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const p = buildPreview(file.table, { hasHeader: file.guess.hasHeader, columns: file.guess.columns!, dateFormat, decimalSeparator: decimal, signConvention: sign }, {
          account, accounts: data.accounts, transactions: data.transactions, recurring: data.recurring, exceptions: data.exceptions, importBatches: data.importBatches, fileHash: file.hash, today,
        });
        setPreview(p);
        setRows(p.candidates.map((x) => ({ ...x, editKind: x.looksLikeTransfer ? 'transfer' : x.kind, editCategory: x.categoryId, otherAccountId: '', linkOccurrence: !!x.occurrenceMatch, expanded: false })));
        setStage('review');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 10);
  };

  const included = rows.filter((r) => r.include);
  const recon = useMemo(() => (preview && account ? reconcilePreview(preview, included, { account, transactions: data.transactions }) : null), [preview, included, account, data.transactions]);
  const blocking = included.filter((r) => r.editKind === 'transfer' && !r.otherAccountId).length;
  const setRow = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const commit = async () => {
    if (!preview || !file || !account || !dateFormat) return;
    setBusy(true);
    let id = '';
    const r = await run((ctx) => {
      const res = commitImport(ctx, {
        accountId: account.id, fileName: file.name, fileHash: file.hash, parserId: 'csv', headerSignature: headerSignature(file.guess.headers), delimiter: file.table.delimiter,
        settings: { hasHeader: file.guess.hasHeader, columns: file.guess.columns!, dateFormat, decimalSeparator: decimal, signConvention: sign },
        decisions: included.map((x) => ({ candidate: x, kind: x.editKind, categoryId: x.editKind === 'transfer' ? null : x.editCategory, merchant: x.merchant, ...(x.otherAccountId ? { otherAccountId: x.otherAccountId } : {}), linkOccurrence: x.linkOccurrence })),
        totalRows: rows.length + preview.errors.length, excludedCount: rows.length - included.length, duplicateCount: rows.filter((x) => x.duplicate).length, errorCount: preview.errors.length,
        reconciliation: recon, applyAdjustment: applyAdj,
      });
      id = res.batch.id;
      return res.ops;
    });
    setBusy(false);
    if (!r.ok) return setError(r.errors.map((e) => e.message).join(' '));
    setBatchId(id);
    setStage('done');
  };

  return (
    <SubScreen title={TERMS.importStatement}>
      <T variant="footnote" color="textSecondary">Read on this phone only. The file is never uploaded or kept — only the transactions you approve are saved, encrypted.</T>
      {error && <T color="negative" accessibilityRole="alert">{error}</T>}
      {busy && <ActivityIndicator />}

      {stage === 'choose' && (
        <Card>
          <Field label="Import into">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {data.accounts.filter((a) => !a.archived).map((a) => <Chip key={a.id} label={a.name} on={a.id === accountId} onPress={() => setAccountId(a.id)} />)}
            </ScrollView>
          </Field>
          <View style={{ marginTop: 14, gap: 8 }}>
            <Button title="Choose CSV file" onPress={() => void choose()} disabled={busy} />
            <T variant="caption" color="textTertiary">Download a CSV export from your bank's app or website, then pick it from Files or Downloads. PDF, OFX/QFX and Excel are not supported yet.</T>
          </View>
        </Card>
      )}

      {stage === 'map' && file && (
        <Card title="Check how the file is read">
          <View style={{ gap: 14 }}>
            <T variant="footnote" color="textSecondary">Columns: {columnSummary(file.guess)}</T>
            <Field label="Date format" error={!dateFormat ? 'These dates could be read two ways. Choose the format your bank uses.' : null}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(file.guess.dateFormats.length ? file.guess.dateFormats : (['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as DateFormat[])).map((f) => <Chip key={f} label={f} on={dateFormat === f} onPress={() => setDateFormat(f)} />)}
              </View>
            </Field>
            <Field label="Decimal separator"><Segmented label="Decimal separator" value={decimal} onChange={setDecimal} options={[{ value: '.', label: '1,234.56' }, { value: ',', label: '1.234,56' }]} /></Field>
            <Field label="Money out appears as" hint={signReason}><Segmented label="Sign convention" value={sign} onChange={(v) => { setSign(v); setSignReason(''); }} options={[{ value: 'as_is', label: 'Negative' }, { value: 'invert', label: 'Positive' }]} /></Field>
            <Button title="Review transactions" disabled={!dateFormat || busy} onPress={review} />
          </View>
        </Card>
      )}

      {stage === 'review' && preview && (
        <>
          {preview.fileAlreadyImported && <T color="warning">This file was already imported. Matching rows are not selected.</T>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Badge label={`${included.length} selected`} tone="accent" />
            <Badge label={`${rows.length} rows`} />
            {rows.some((r) => r.duplicate) && <Badge label={`${rows.filter((r) => r.duplicate).length} possible duplicates`} tone="warn" />}
            {preview.errors.length > 0 && <Badge label={`${preview.errors.length} unreadable`} tone="neg" />}
          </View>
          <Card>
            {rows.map((r, i) => (
              <View key={r.rowNumber} style={{ borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: c.border, paddingVertical: 10, opacity: r.include ? 1 : 0.55 }}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: r.include }} onPress={() => setRow(i, { include: !r.include })} onLongPress={() => setRow(i, { expanded: !r.expanded })} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: r.include ? c.accent : c.borderStrong, backgroundColor: r.include ? c.accent : 'transparent' }} />
                  <View style={{ flex: 1 }}>
                    <T numberOfLines={1} style={{ fontFamily: 'Inter_500Medium' }}>{r.merchant || r.rawDescription || 'No description'}</T>
                    <T variant="caption" color="textTertiary">{formatShortDate(r.date)} · {r.editKind}{r.editCategory ? ` · ${data.categories.find((x) => x.id === r.editCategory)?.name ?? ''}` : ''}</T>
                  </View>
                  <Money cents={r.amountCents} currency={cur} sign="always" color={r.amountCents > 0 ? 'positive' : 'text'} style={{ fontFamily: 'Inter_600SemiBold' }} />
                </Pressable>
                {(r.duplicate || r.reasons.length > 0 || r.occurrenceMatch) && (
                  <View style={{ marginLeft: 32, marginTop: 4, gap: 4 }}>
                    {r.duplicate && <Badge label={r.duplicate.level === 'exact' ? 'Already imported' : 'Possible duplicate'} tone={r.duplicate.level === 'exact' ? 'neg' : 'warn'} />}
                    {r.occurrenceMatch && <Check label={`Pays ${r.occurrenceMatch.name}`} value={r.linkOccurrence} onChange={(v) => setRow(i, { linkOccurrence: v })} />}
                    <T variant="caption" color="textSecondary">{[r.duplicate?.reason, ...r.reasons].filter(Boolean).join(' ')}</T>
                  </View>
                )}
                <Pressable onPress={() => setRow(i, { expanded: !r.expanded })} accessibilityRole="button" style={{ marginLeft: 32, marginTop: 4 }}><T variant="caption" color="accent">{r.expanded ? 'Done' : 'Change type or category'}</T></Pressable>
                {r.expanded && (
                  <View style={{ marginLeft: 32, marginTop: 8, gap: 8 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {(r.amountCents < 0 ? (['expense', 'transfer'] as const) : (['income', 'refund', 'transfer'] as const)).map((k) => <Chip key={k} label={k} on={r.editKind === k} onPress={() => setRow(i, { editKind: k })} />)}
                    </ScrollView>
                    {r.editKind === 'transfer' ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                        {data.accounts.filter((a) => !a.archived && a.id !== accountId).map((a) => <Chip key={a.id} label={`${r.amountCents < 0 ? 'To' : 'From'} ${a.name}`} on={r.otherAccountId === a.id} onPress={() => setRow(i, { otherAccountId: a.id, include: true })} />)}
                      </ScrollView>
                    ) : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                        {data.categories.filter((x) => !x.archived && x.kind === (r.editKind === 'income' ? 'income' : 'expense')).map((x) => <Chip key={x.id} label={x.name} on={r.editCategory === x.id} onPress={() => setRow(i, { editCategory: x.id })} />)}
                      </ScrollView>
                    )}
                  </View>
                )}
              </View>
            ))}
          </Card>
          {preview.errors.length > 0 && (
            <Card title="Could not be read (not imported)">
              {preview.errors.map((e) => <T key={e.rowNumber} variant="footnote" color="textSecondary">Line {e.rowNumber}: {e.reason}</T>)}
            </Card>
          )}
          {recon && (
            <Card title="Balance check">
              {recon.note ? <T color="textSecondary">{recon.note}</T> : (
                <>
                  <T color="textSecondary">Statement on {formatShortDate(recon.statementDate)}: <Money cents={recon.statementBalanceCents} currency={cur} /> · Clarity after import: <Money cents={recon.appBalanceCents} currency={cur} /></T>
                  {recon.differenceCents === 0 ? <T color="positive">Matches</T> : <Check label={`Record a balance adjustment of ${formatCents(recon.differenceCents, cur, { sign: 'always' })} so this account matches the statement`} value={applyAdj} onChange={setApplyAdj} />}
                </>
              )}
            </Card>
          )}
          {blocking > 0 && <T color="warning">Choose the other account for {blocking} transfer{blocking > 1 ? 's' : ''}.</T>}
          <Button title={`Import ${included.length} transaction${included.length === 1 ? '' : 's'}`} disabled={busy || included.length === 0 || blocking > 0} busy={busy} onPress={() => void commit()} />
        </>
      )}

      {stage === 'done' && (
        <Card>
          <T variant="title2" color="positive">Imported {included.length} transaction{included.length === 1 ? '' : 's'}</T>
          <T color="textSecondary">Balances and forecast are updated. The statement file was not kept.</T>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button title="Undo import" kind="secondary" small onPress={async () => { if (!batchId) return; const r = await run((ctx) => undoImportBatch(ctx, batchId)); if (r.ok) { toast({ message: 'Import undone' }); setStage('choose'); } }} />
            <Button title="Done" small onPress={() => router.back()} />
          </View>
        </Card>
      )}
    </SubScreen>
  );
}

function columnSummary(g: MappingGuess): string {
  const cols = g.columns;
  if (!cols) return '';
  const entries: [string, number | undefined][] = [['date', cols.date], ['description', cols.description], ['amount', cols.amount], ['debit', cols.debit], ['credit', cols.credit], ['balance', cols.balance]];
  return entries.filter(([, i]) => i !== undefined).map(([k, i]) => `${k} → “${g.headers[i!] ?? ''}”`).join(', ');
}
