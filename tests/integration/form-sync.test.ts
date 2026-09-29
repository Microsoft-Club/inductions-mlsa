// The form-sync edge function against the local stack, as the Google Form's Apps Script calls it:
// no Supabase login, just the shared secret. Needs `npm run functions:serve` with
// supabase/functions/.env copied from .env.example.
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fixture from '../../fixtures/form-export-fake.csv?raw';
import { createApi, type Api } from '../../src/lib/api.ts';
import { env, makeAccount, service, signIn, uniqueName } from './support.ts';

const [HEADER, FIRST] = Papa.parse<string[]>(fixture.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' }).data;
const COLUMN = { accountEmail: 1, fullName: 2, email: 3, reg: 4 };

function localSecret(): string {
  let text = '';
  try {
    text = readFileSync('supabase/functions/.env', 'utf8');
  } catch {
    // reported below
  }
  const secret = /^FORM_SYNC_SECRET=(.+)$/m.exec(text)?.[1]?.trim();
  if (!secret) throw new Error('Copy supabase/functions/.env.example to supabase/functions/.env, then restart npm run functions:serve');
  return secret;
}

async function send(body: unknown, secret: string) {
  const res = await fetch(`${env.url}/functions/v1/form-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-form-sync-secret': secret },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('form-sync edge function', () => {
  const secret = localSecret();
  const reg = `FS${Date.now().toString(36).toUpperCase()}`;
  const response = (name: string) => {
    const values = [...FIRST];
    values[COLUMN.fullName] = name;
    values[COLUMN.accountEmail] = `${reg.toLowerCase()}.account@example.test`;
    values[COLUMN.email] = `${reg.toLowerCase()}@example.test`;
    values[COLUMN.reg] = reg;
    return { header: HEADER, values };
  };
  const accountIds: string[] = [];
  let qm: Api;

  beforeAll(async () => {
    const name = uniqueName('fs_qm');
    accountIds.push(await makeAccount(name, 'queue_manager'));
    qm = createApi(await signIn(name));
  });

  afterAll(async () => {
    await service.from('candidates').delete().eq('reg_number', reg);
    await service.from('form_warnings').delete().or(`reg_number.eq.${reg},reason.like.A form response was not imported*`);
    for (const id of accountIds) await service.auth.admin.deleteUser(id);
  });

  it('refuses a wrong secret itself (the gateway lets the request through without a login)', async () => {
    expect(await send(response('Nobody'), 'wrong-secret')).toEqual({ status: 401, body: { error: 'Not allowed' } });
  });

  it('adds a new response to the candidates', async () => {
    expect(await send(response('Form Sync Tester'), secret)).toEqual({ status: 200, body: { added: 1, updated: 0, flagged: [] } });
    const { data } = await service.from('candidates').select('full_name, status').eq('reg_number', reg).single();
    expect(data).toEqual({ full_name: 'Form Sync Tester', status: 'registered' });
  });

  it('shows a warning on the board for a second response with the same reg number, until dismissed', async () => {
    const res = await send(response('Form Sync Tester Two'), secret);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 0, updated: 1 });

    const warning = (await qm.boardSnapshot()).form_warnings.find((w) => w.reg_number === reg);
    expect(warning).toMatchObject({
      name: 'Form Sync Tester Two',
      reason: 'Another response came in for this reg number; kept the latest answers (earlier name: Form Sync Tester)',
    });

    await qm.dismissFormWarning(warning!.id);
    expect((await qm.boardSnapshot()).form_warnings.find((w) => w.id === warning!.id)).toBeUndefined();
  });

  it('turns a changed form into a board warning instead of importing', async () => {
    const header = [...HEADER];
    header[8] = 'A brand new question';
    const res = await send({ header, values: FIRST }, secret);
    expect(res.status).toBe(422);
    const warnings = (await qm.boardSnapshot()).form_warnings;
    expect(warnings.some((w) => w.reason.startsWith('A form response was not imported: the form\'s questions no longer match'))).toBe(true);
  });
});
