import Papa from 'papaparse';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/form-export-fake.csv?raw';
import { parseFormExport } from '../../src/csv/parseFormExport.ts';
import { handleFormSync, type FormSyncDeps } from '../../supabase/functions/form-sync/handler.ts';

const SECRET = 'test-form-sync-secret';
const [HEADER, ...RESPONSES] = Papa.parse<string[]>(fixture.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' }).data;

function deps(overrides: Partial<FormSyncDeps> = {}): FormSyncDeps {
  return {
    secret: SECRET,
    syncResponse: vi.fn(async () => ({ data: { added: 1, updated: 0, flagged: [] }, error: null })),
    noteProblem: vi.fn(async () => ({ data: null, error: null })),
    ...overrides,
  };
}

function post(body: unknown, secret: string | null = SECRET): Request {
  return new Request('http://localhost/functions/v1/form-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret === null ? {} : { 'x-form-sync-secret': secret }) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(req: Request, d = deps()) {
  const res = await handleFormSync(req, d);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, deps: d };
}

describe('handleFormSync', () => {
  it('imports a response exactly as the CSV import reads the same row', async () => {
    const { status, body, deps: d } = await call(post({ header: HEADER, values: RESPONSES[0] }));
    expect(status).toBe(200);
    expect(body).toEqual({ added: 1, updated: 0, flagged: [] });
    const csv = parseFormExport(fixture);
    if (!csv.ok) throw new Error(csv.error);
    expect(d.syncResponse).toHaveBeenCalledExactlyOnceWith(csv.rows[0]);
    expect(d.noteProblem).not.toHaveBeenCalled();
  });

  it('refuses callers without the secret, and says nothing to the database', async () => {
    for (const secret of [null, '', 'wrong-secret', `${SECRET}x`]) {
      const { status, body, deps: d } = await call(post({ header: HEADER, values: RESPONSES[0] }, secret));
      expect({ status, body }).toEqual({ status: 401, body: { error: 'Not allowed' } });
      expect(d.syncResponse).not.toHaveBeenCalled();
      expect(d.noteProblem).not.toHaveBeenCalled();
    }
  });

  it('refuses everything until the secret is set up', async () => {
    for (const secret of [undefined, '']) {
      const { status, body } = await call(post({ header: HEADER, values: RESPONSES[0] }, ''), deps({ secret }));
      expect({ status, body }).toEqual({ status: 503, body: { error: 'Form sync is not set up (FORM_SYNC_SECRET is missing)' } });
    }
  });

  it('accepts only POST', async () => {
    const { status } = await call(new Request('http://localhost/functions/v1/form-sync', { headers: { 'x-form-sync-secret': SECRET } }));
    expect(status).toBe(405);
  });

  it('rejects bodies that are not one response', async () => {
    const bad = ['not json', { header: HEADER }, { header: HEADER, values: 'x' }, { header: HEADER, values: [1, 2] }, [HEADER, RESPONSES[0]]];
    for (const body of bad) {
      const res = await call(post(body));
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(res.body.error).toMatch(/^Send one response as JSON/);
      expect(res.deps.syncResponse).not.toHaveBeenCalled();
    }
  });

  it('rejects oversized bodies', async () => {
    const values = [...RESPONSES[0]];
    values[8] = 'x'.repeat(1_100_000);
    const { status, body } = await call(post({ header: HEADER, values }));
    expect({ status, body }).toEqual({ status: 413, body: { error: 'That response is too large' } });
  });

  it('puts a warning on the board when the form no longer matches, instead of misfiling answers', async () => {
    const header = [...HEADER];
    header[8] = 'What brings you here?';
    const { status, body, deps: d } = await call(post({ header, values: RESPONSES[0] }));
    expect(status).toBe(422);
    expect(body.mismatches).toEqual([
      { column: 9, expected: '(not in the app)', found: 'What brings you here?' },
      { column: 9, expected: 'What motivated you to join Microsoft Club?', found: '(missing)' },
    ]);
    expect(d.syncResponse).not.toHaveBeenCalled();
    expect(d.noteProblem).toHaveBeenCalledExactlyOnceWith(
      'A form response was not imported: the form\'s questions no longer match the app ("What brings you here?" is new, and 1 more change). ' +
        'Update the form layout in the app, then use Import CSV to catch up.',
    );
    expect(body.error).toBe(vi.mocked(d.noteProblem).mock.calls[0][0]);
  });

  it('counts extra mismatched columns in the warning', async () => {
    const { deps: d } = await call(post({ header: [...HEADER, 'New question', 'Another'], values: [...RESPONSES[0], 'a', 'b'] }));
    expect(d.noteProblem).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('("New question" is new, and 1 more change)'));
  });

  it('warns when a response has a different number of cells than the header', async () => {
    const { status, deps: d } = await call(post({ header: HEADER, values: RESPONSES[0].slice(0, 40) }));
    expect(status).toBe(422);
    expect(d.noteProblem).toHaveBeenCalledExactlyOnceWith(
      'A form response was not imported: it had 40 cells but the form has 54 columns. Use Import CSV to catch up.',
    );
  });

  it('reads the questions in whatever order the sheet has them', async () => {
    // Google rebuilds a responses tab in the form's order when the sheet is linked again.
    const order = HEADER.map((_, i) => i);
    const brainees = order.splice(51, 3);
    order.splice(36, 0, ...brainees);
    const { status, deps: d } = await call(post({ header: order.map((i) => HEADER[i]), values: order.map((i) => RESPONSES[0][i]) }));
    expect(status).toBe(200);
    const csv = parseFormExport(fixture);
    if (!csv.ok) throw new Error(csv.error);
    expect(d.syncResponse).toHaveBeenCalledExactlyOnceWith(csv.rows[0]);
  });

  it('reports when there is no active induction', async () => {
    const d = deps({ syncResponse: vi.fn(async () => ({ data: null, error: { message: 'No active induction' } })) });
    const { status, body } = await call(post({ header: HEADER, values: RESPONSES[0] }), d);
    expect({ status, body }).toEqual({ status: 409, body: { error: 'No active induction' } });
  });

  it('reports other database errors', async () => {
    const d = deps({ syncResponse: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) });
    const { status, body } = await call(post({ header: HEADER, values: RESPONSES[0] }), d);
    expect({ status, body }).toEqual({ status: 500, body: { error: 'boom' } });
  });
});
