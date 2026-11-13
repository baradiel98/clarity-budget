import { createContext, useContext } from 'react';
import type { Explanation } from '@clarity/engine';
import type { TxInput } from '@clarity/data';

export interface AddPrefill extends Partial<TxInput> {
  editId?: string;
  occurrenceName?: string;
}

export interface UiApi {
  openAdd(prefill?: AddPrefill): void;
  openAfford(): void;
  explain(ex: Explanation): void;
}

export const UiCtx = createContext<UiApi>({ openAdd: () => {}, openAfford: () => {}, explain: () => {} });
export const useUi = () => useContext(UiCtx);
