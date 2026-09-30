import Papa from 'papaparse';
import { FORM_LAYOUT, type FormLayout } from '../../supabase/functions/_shared/formLayout.ts';
import { mapRow, matchColumns, type HeaderMismatch, type ImportRow } from '../../supabase/functions/_shared/formRows.ts';

export type { HeaderMismatch };

export type ParseResult =
  | { ok: true; rows: ImportRow[]; warnings: string[] }
  | { ok: false; error: string; mismatches: HeaderMismatch[] };

/**
 * Reads a Google Forms CSV export in the browser. Columns may come in any order; each question is
 * found by its title. Stops (imports nothing) when a question is new, renamed or missing, or a row
 * has the wrong number of columns. Every row is returned, including
 * duplicates and rows without a reg number: import_candidates de-duplicates and flags those.
 */
export function parseFormExport(text: string, layout: FormLayout = FORM_LAYOUT): ParseResult {
  const fail = (error: string, mismatches: HeaderMismatch[] = []): ParseResult => ({ ok: false, error, mismatches });
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const [header, ...records] = parsed.data;
  if (!header) return fail('The file is empty.');

  const { indexes, mismatches } = matchColumns(header, layout);
  if (mismatches.length > 0) {
    return fail(`The columns don't match the ${layout.name}. Nothing was imported.`, mismatches);
  }
  if (records.length === 0) return fail('The file has no responses.');

  const rows: ImportRow[] = [];
  const warnings: string[] = [];
  for (const [index, cells] of records.entries()) {
    const rowNumber = index + 2; // the header is row 1
    if (cells.length !== header.length) {
      return fail(`Row ${rowNumber} has ${cells.length} columns; expected ${header.length}. Nothing was imported.`);
    }
    const { row, rawTimestamp } = mapRow(cells, layout, indexes);
    if (row.submitted_at === null) {
      warnings.push(
        `Row ${rowNumber} (${row.full_name || 'no name'}): the timestamp "${rawTimestamp}" can't be read, ` +
          'so this person is numbered as if they submitted just now.',
      );
    }
    rows.push(row);
  }
  return { ok: true, rows, warnings };
}
