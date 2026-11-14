import { describe, expect, it } from 'vitest';
import { csvParser, dataRowCount, guessMapping, nonBlankRowCount } from '../src';

describe('Phase 3A: CSV with column names but no transactions', () => {
  for (const [name, text] of [['headers only', 'Date,Description,Amount\n'], ['headers + blank lines', 'Date,Description,Amount\n\n\n'], ['headers + empty cells', 'Date,Description,Amount\n,,\n']] as const) {
    it(`${name}: detected as having no data rows`, () => {
      const t = csvParser.parse(text);
      expect(guessMapping(t).hasHeader).toBe(true);
      expect(dataRowCount(nonBlankRowCount(t.rows), true)).toBe(0);
    });
  }
  it('one real row is still one row', () => {
    const t = csvParser.parse('Date,Description,Amount\n2026-11-01,Coffee,-4.50\n');
    expect(dataRowCount(nonBlankRowCount(t.rows), guessMapping(t).hasHeader)).toBe(1);
  });
});
