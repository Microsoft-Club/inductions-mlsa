// Runs the Apps Script (scripts/google-form-sync.gs) in Node with stand-ins for Google's services,
// and feeds what it sends to the real form-sync handler, so the two can't drift apart.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import Papa from 'papaparse';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/form-export-fake.csv?raw';
import { parseFormExport } from '../../src/csv/parseFormExport.ts';
import { handleFormSync } from '../../supabase/functions/form-sync/handler.ts';

const SCRIPT = readFileSync('scripts/google-form-sync.gs', 'utf8');
const ROWS = Papa.parse<string[]>(fixture.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' }).data;
const URL = 'https://example.supabase.co/functions/v1/form-sync';
const SECRET = 'script-test-secret';

interface FetchOptions {
  method: string;
  contentType: string;
  headers: Record<string, string>;
  payload: string;
  muteHttpExceptions: boolean;
}

/** A responses sheet holding the fake export, plus the Google services the script uses. */
function google({ properties = { SYNC_URL: URL, SYNC_SECRET: SECRET }, statuses = [200] }: { properties?: Record<string, string>; statuses?: number[] } = {}) {
  const sent: Array<{ url: string; options: FetchOptions }> = [];
  const sheet = {
    getLastRow: () => ROWS.length,
    getLastColumn: () => ROWS[0].length,
    getFormUrl: () => 'https://docs.google.com/forms/d/x/viewform',
    getRange: (row: number, column: number, rows: number, columns: number) => {
      expect([column, rows]).toEqual([1, 1]);
      return { getDisplayValues: () => [ROWS[row - 1].slice(0, columns)] };
    },
  };
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key] ?? null }) },
    SpreadsheetApp: { getActive: () => ({ getSheets: () => [{ getFormUrl: () => null }, sheet] }) },
    UrlFetchApp: {
      fetch: vi.fn((url: string, options: FetchOptions) => {
        sent.push({ url, options });
        const status = statuses[Math.min(sent.length, statuses.length) - 1];
        return { getResponseCode: () => status, getContentText: () => (status === 200 ? '{"added":1}' : '{"error":"nope"}') };
      }),
    },
    Utilities: { sleep: vi.fn() },
    Logger: { log: vi.fn() },
  };
  runInNewContext(SCRIPT, context);
  const fns = context as unknown as Record<string, (arg?: unknown) => unknown>;
  return { sheet, sent, context, fns };
}

describe('google-form-sync.gs', () => {
  it('sends the submitted row with the header, which the form-sync function imports like the CSV', async () => {
    const g = google();
    g.fns.onFormSubmit({ range: { getSheet: () => g.sheet, getRow: () => 2 } });

    expect(g.sent).toHaveLength(1);
    const [{ url, options }] = g.sent;
    expect(url).toBe(URL);
    expect(options).toMatchObject({ method: 'post', contentType: 'application/json', headers: { 'x-form-sync-secret': SECRET }, muteHttpExceptions: true });

    const syncResponse = vi.fn(async () => ({ data: { added: 1, updated: 0, flagged: [] }, error: null }));
    const req = new Request(url, { method: 'POST', headers: options.headers, body: options.payload });
    const res = await handleFormSync(req, { secret: SECRET, syncResponse, noteProblem: vi.fn() });
    expect(res.status).toBe(200);
    const csv = parseFormExport(fixture);
    if (!csv.ok) throw new Error(csv.error);
    expect(syncResponse).toHaveBeenCalledExactlyOnceWith(csv.rows[0]);
  });

  it('sendLatestResponse re-sends the last row of the responses sheet, for checking the setup', () => {
    const g = google();
    g.fns.sendLatestResponse();
    expect(JSON.parse(g.sent[0].options.payload).values).toEqual(ROWS[ROWS.length - 1]);
    expect(g.context.Logger.log).toHaveBeenCalledWith(expect.stringContaining('{"added":1}'));
  });

  it('retries when the app is briefly unavailable', () => {
    const g = google({ statuses: [503, 502, 200] });
    g.fns.onFormSubmit({ range: { getSheet: () => g.sheet, getRow: () => 3 } });
    expect(g.sent).toHaveLength(3);
    expect(g.context.Utilities.sleep).toHaveBeenCalledTimes(2);
  });

  it('fails the run (so Google emails the owner) when the app refuses the response', () => {
    const g = google({ statuses: [401] });
    expect(() => g.fns.onFormSubmit({ range: { getSheet: () => g.sheet, getRow: () => 2 } })).toThrow(
      'The induction app did not take row 2: HTTP 401 {"error":"nope"}',
    );
    expect(g.sent).toHaveLength(1);
  });

  it('gives up after three failed tries', () => {
    const g = google({ statuses: [500] });
    expect(() => g.fns.onFormSubmit({ range: { getSheet: () => g.sheet, getRow: () => 2 } })).toThrow('HTTP 500');
    expect(g.sent).toHaveLength(3);
  });

  it('explains missing setup', () => {
    const g = google({ properties: {} });
    expect(() => g.fns.onFormSubmit({ range: { getSheet: () => g.sheet, getRow: () => 2 } })).toThrow(
      'Set SYNC_URL and SYNC_SECRET under Project Settings → Script properties',
    );
  });
});
