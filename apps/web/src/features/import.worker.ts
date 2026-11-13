/// <reference lib="webworker" />
import { buildPreview, csvParser, guessMapping, suggestSignConvention, type ImportSettings, type PreviewContext, type RawTable } from '@clarity/import';
import type { Account } from '@clarity/shared';

/** Statement parsing runs here, off the main thread. Nothing is sent over the network. */
let table: RawTable | null = null;

type Msg =
  | { id: number; type: 'analyze'; text: string }
  | { id: number; type: 'sign'; settings: Omit<ImportSettings, 'signConvention'>; account: Account }
  | { id: number; type: 'preview'; settings: ImportSettings; ctx: PreviewContext };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'analyze') {
      table = csvParser.parse(m.text);
      const guess = guessMapping(table);
      self.postMessage({ id: m.id, ok: true, result: { guess, sample: table.rows.slice(0, 12), rowCount: table.rows.length, delimiter: table.delimiter } });
    } else if (m.type === 'sign') {
      self.postMessage({ id: m.id, ok: true, result: suggestSignConvention(table!, m.settings, m.account) });
    } else {
      self.postMessage({ id: m.id, ok: true, result: buildPreview(table!, m.settings, m.ctx) });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : 'Could not read this file.' });
  }
};
