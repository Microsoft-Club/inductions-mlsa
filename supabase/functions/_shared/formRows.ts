// Turning one Google Form response (its cells, in the responses sheet's column order) into the row
// import_candidates and sync_form_response expect. Shared by the browser's CSV import and the
// form-sync edge function, so both read the form the same way.
import type { FormLayout } from './formLayout.ts';

export type AnswerSection = 'general' | 'dev' | 'logikal' | 'lnd' | 'marketing' | 'brainees';

export interface Answer {
  q: string;
  a: string;
}

/** One form response, as import_candidates(p_rows) expects it. */
export interface ImportRow {
  /** ISO 8601 with offset, or null when the timestamp couldn't be read (the server then uses now()). */
  submitted_at: string | null;
  reg_number: string;
  full_name: string;
  email: string;
  account_email: string;
  phone: string;
  department: string;
  batch: string;
  /** Team preferences 1–4 in rank order; '' when a rank was left blank. */
  preferences: string[];
  answers: Record<AnswerSection, Answer[]>;
}

export interface HeaderMismatch {
  /** 1-based, as a spreadsheet user counts columns. */
  column: number;
  expected: string;
  found: string;
}

export function normalizeHeader(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Google Sheets' "M/D/YYYY H:MM:SS" in the form's time zone → ISO 8601, or null if unreadable. */
export function parseSheetsTimestamp(text: string, utcOffset: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const [month, day, year, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) => Number(match[i] ?? '0'));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${utcOffset}`;
}

/** Every header cell that differs from the layout (none = the form still matches). */
export function headerMismatches(header: string[], layout: FormLayout): HeaderMismatch[] {
  const expected = layout.columns.map((column) => normalizeHeader(column.header));
  const found = header.map(normalizeHeader);
  const mismatches: HeaderMismatch[] = [];
  for (let i = 0; i < Math.max(expected.length, found.length); i++) {
    if (expected[i] !== found[i]) {
      mismatches.push({ column: i + 1, expected: expected[i] ?? '(no column)', found: found[i] ?? '(missing)' });
    }
  }
  return mismatches;
}

/** One response's cells → an import row. `rawTimestamp` is the Timestamp cell, for warnings. */
export function mapRow(cells: string[], layout: FormLayout): { row: ImportRow; rawTimestamp: string } {
  const row: ImportRow = {
    submitted_at: null,
    reg_number: '',
    full_name: '',
    email: '',
    account_email: '',
    phone: '',
    department: '',
    batch: '',
    preferences: ['', '', '', ''],
    answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [], brainees: [] },
  };
  let rawTimestamp = '';
  layout.columns.forEach((column, i) => {
    const value = (cells[i] ?? '').trim();
    const target = column.target;
    if (target.kind === 'answer') {
      row.answers[target.section].push({ q: normalizeHeader(column.header), a: value });
    } else if (target.kind === 'preference') {
      row.preferences[target.rank - 1] = value;
    } else if (target.field === 'submitted_at') {
      rawTimestamp = value;
      row.submitted_at = parseSheetsTimestamp(value, layout.utcOffset);
    } else {
      row[target.field] = value;
    }
  });
  return { row, rawTimestamp };
}
