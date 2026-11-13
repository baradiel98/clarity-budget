import type { Explanation } from '@clarity/engine';
import type { TxInput } from '@clarity/data';

/** Hand-off for modal screens (values are in-memory only, never serialized into URLs). */
export interface AddPrefill extends Partial<TxInput> {
  editId?: string;
  occurrenceName?: string;
}

let explain: Explanation | null = null;
let addPrefill: AddPrefill | null = null;

export const setExplain = (e: Explanation) => (explain = e);
export const takeExplain = () => explain;
export const setAddPrefill = (p: AddPrefill | null) => (addPrefill = p);
export const takeAddPrefill = () => {
  const p = addPrefill;
  addPrefill = null;
  return p;
};
