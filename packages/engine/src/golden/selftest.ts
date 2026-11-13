import { buildDashboard } from '../plan';
import { GOLDEN_EXPECTED } from './expected';
import { GOLDEN_SCENARIOS, goldenSummary } from './scenarios';

export interface EngineSelfTestResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Recompute every golden scenario and compare with the outputs recorded in Node. */
export function runEngineSelfTest(): EngineSelfTestResult[] {
  return Object.entries(GOLDEN_SCENARIOS).map(([name, input]) => {
    try {
      const got = JSON.stringify(goldenSummary(buildDashboard(input)));
      const want = JSON.stringify(GOLDEN_EXPECTED[name]);
      return got === want ? { name, ok: true } : { name, ok: false, detail: 'Output differs from the recorded result.' };
    } catch (e) {
      return { name, ok: false, detail: (e as Error).message };
    }
  });
}
