import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/form-export-fake.csv?raw';
import { FORM_LAYOUT } from '../../../supabase/functions/_shared/formLayout.ts';
import { parseSheetsTimestamp } from '../../../supabase/functions/_shared/formRows.ts';
import { parseFormExport } from '../../../src/csv/parseFormExport.ts';

/** The fake export with one header cell renamed. */
function renameHeader(from: string, to: string): string {
  return fixture.replace(`,${from},`, `,${to},`);
}

function ok(text: string) {
  const result = parseFormExport(text);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

describe('parseSheetsTimestamp', () => {
  it('reads Google Sheets timestamps as Asia/Karachi time', () => {
    expect(parseSheetsTimestamp('9/25/2026 20:47:58', '+05:00')).toBe('2026-09-25T20:47:58+05:00');
    expect(parseSheetsTimestamp('12/1/2026 7:05:09', '+05:00')).toBe('2026-12-01T07:05:09+05:00');
    expect(parseSheetsTimestamp(' 9/25/2026 8:05 ', '+05:00')).toBe('2026-09-25T08:05:00+05:00');
  });

  it('rejects anything that is not a real date and time', () => {
    for (const bad of ['', 'yesterday', '2/30/2026 10:00:00', '9/25/2026 24:00:00', '9/25/2026 10:60:00', '2026-09-25 10:00']) {
      expect(parseSheetsTimestamp(bad, '+05:00'), bad).toBeNull();
    }
  });
});

describe('parseFormExport', () => {
  it('maps every column of the fake export', () => {
    const { rows, warnings } = ok(fixture);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(5);
    const [ali, aisha, zara, aliAgain, noReg] = rows;

    expect(ali).toMatchObject({
      submitted_at: '2026-09-20T10:15:02+05:00',
      account_email: 'ali.account@example.test',
      full_name: 'Ali Raza',
      email: 'ali.raza@example.test',
      reg_number: '2099101',
      phone: '03001234501',
      department: 'Computer Science',
      batch: 'B35',
      preferences: ['Dev Team', 'Marketing', 'L&D', 'LogiKal'],
    });
    expect(ali.answers.general).toHaveLength(16);
    expect(ali.answers.general[0]).toEqual({ q: 'What motivated you to join Microsoft Club?', a: 'Ali answer 1' });
    expect(ali.answers.general[15]).toEqual({
      q: 'What makes you different from other applicants — why should we choose you? Mention very briefly in 2-3 lines',
      a: 'I finish what I start.',
    });
    expect(ali.answers.dev.map((x) => x.a)).toEqual(['Ali dev 1', 'Ali dev 2', 'Ali dev 3', 'Ali dev 4', 'Ali dev 5', 'Ali dev 6', 'Ali dev 7']);
    expect([ali.answers.logikal.length, ali.answers.lnd.length, ali.answers.marketing.length]).toEqual([6, 4, 6]);
    expect(ali.answers.brainees.map((x) => x.a)).toEqual(['Ali brainees 1', 'Ali brainees 2', 'Ali brainees 3']);
    expect(ali.answers.brainees[0].q).toBe('Why do you want to do research?');
    expect(ali.answers.logikal[1].q).toBe('Which parts of LogiKal interest you most? Select up to 2');

    // Byte-for-byte names, multi-line answers with commas and quotes, and messy reg numbers.
    expect(aisha.full_name).toBe('عائشہ خان');
    expect(aisha.reg_number).toBe('2099 102');
    expect(aisha.answers.general[0].a).toBe('First line\nSecond line, with a comma and "quotes"');
    expect(aisha.answers.general[15].a).toBe('میں ٹیم کے ساتھ کام کرنا پسند کرتی ہوں۔');
    expect(aisha.preferences).toEqual(['LogiKal', 'L&D', '', '']);
    expect(zara.full_name).toBe("Zara O'Brien-Khan");
    expect(zara.submitted_at).toBe('2026-09-21T09:05:10+05:00');
    expect(zara.answers.dev.every((x) => x.a === '')).toBe(true);
    expect(zara.answers.brainees.every((x) => x.a === '')).toBe(true); // answered before the Brainees questions existed

    // Duplicates and missing reg numbers are passed through; the database flags them.
    expect(aliAgain.reg_number).toBe('2099101');
    expect(aliAgain.phone).toBe('03001234599');
    expect(noReg.reg_number).toBe('');
  });

  it('accepts a byte-order mark and LF line endings', () => {
    expect(ok('﻿' + fixture).rows).toHaveLength(5);
    const lf = fixture.replaceAll('\r\n', '\n');
    expect(ok(lf).rows[1].answers.general[0].a).toBe('First line\nSecond line, with a comma and "quotes"');
  });

  it('stops and names the columns when the header does not match', () => {
    const result = parseFormExport(renameHeader('Registration Number', 'Reg No'));
    expect(result).toEqual({
      ok: false,
      error: "The columns don't match the Fall 2026 induction form. Nothing was imported.",
      mismatches: [
        { column: 5, expected: '(not in the app)', found: 'Reg No' },
        { column: 5, expected: 'Registration Number', found: '(missing)' },
      ],
    });
  });

  it('reads the columns in any order, matching each question by its title', () => {
    // A responses tab rebuilt by Google puts the Brainees questions after LogiKal instead of at the end.
    const [header, ...records] = Papa.parse<string[]>(fixture, { skipEmptyLines: 'greedy' }).data;
    const order = header.map((_, i) => i);
    const brainees = order.splice(51, 3);
    order.splice(36, 0, ...brainees);
    const reordered = Papa.unparse([header, ...records].map((cells) => order.map((i) => cells[i])));
    expect(ok(reordered).rows).toEqual(ok(fixture).rows);
  });

  it('matches a repeated title to its copies in order', () => {
    // "Email Address" is both the collected address (column 2) and a question (column 4). Moving the
    // question to the end keeps the two in the same order, so each still lands in its own field.
    const [header, ...records] = Papa.parse<string[]>(fixture, { skipEmptyLines: 'greedy' }).data;
    const order = [...header.keys()].filter((i) => i !== 3).concat(3);
    const moved = ok(Papa.unparse([header, ...records].map((cells) => order.map((i) => cells[i]))));
    expect([moved.rows[0].account_email, moved.rows[0].email]).toEqual(['ali.account@example.test', 'ali.raza@example.test']);
  });

  it('reports a missing last column', () => {
    const [header] = Papa.parse<string[]>(fixture).data; // the last header cell has commas inside quotes
    const result = parseFormExport(Papa.unparse([header.slice(0, -1)]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mismatches).toEqual([
      { column: 54, expected: FORM_LAYOUT.columns[53].header, found: '(missing)' },
    ]);
  });

  it('refuses empty files, files without responses and rows with the wrong number of columns', () => {
    expect(parseFormExport('')).toEqual({ ok: false, error: 'The file is empty.', mismatches: [] });
    const header = fixture.slice(0, fixture.indexOf('\r\n9/20/2026'));
    expect(parseFormExport(header)).toEqual({ ok: false, error: 'The file has no responses.', mismatches: [] });
    expect(parseFormExport(header + '\r\n9/20/2026 10:15:02,a@example.test,Short Row')).toEqual({
      ok: false,
      error: 'Row 2 has 3 columns; expected 54. Nothing was imported.',
      mismatches: [],
    });
  });

  it('keeps rows with unreadable timestamps and warns about them', () => {
    const result = ok(fixture.replace('9/21/2026 9:05:10', 'yesterday'));
    expect(result.rows[2].submitted_at).toBeNull();
    expect(result.warnings).toEqual([
      `Row 4 (Zara O'Brien-Khan): the timestamp "yesterday" can't be read, so this person is numbered as if they submitted just now.`,
    ]);
  });
});
