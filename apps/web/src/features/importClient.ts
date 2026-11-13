import type { ImportPreview, ImportSettings, MappingGuess, PreviewContext } from '@clarity/import';
import type { Account, SignConvention } from '@clarity/shared';

export interface Analysis {
  guess: MappingGuess;
  sample: string[][];
  rowCount: number;
  delimiter: string;
}

/** Promise wrapper around the import worker. */
export class ImportClient {
  private w = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  constructor() {
    this.w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = this.waiting.get(e.data.id);
      if (!p) return;
      this.waiting.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
  }
  private call<T>(msg: object): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.w.postMessage({ ...msg, id });
    });
  }
  analyze(text: string) {
    return this.call<Analysis>({ type: 'analyze', text });
  }
  suggestSign(settings: Omit<ImportSettings, 'signConvention'>, account: Account) {
    return this.call<{ convention: SignConvention; reason: string }>({ type: 'sign', settings, account });
  }
  preview(settings: ImportSettings, ctx: PreviewContext) {
    return this.call<ImportPreview>({ type: 'preview', settings, ctx });
  }
  dispose() {
    this.w.terminate();
  }
}
