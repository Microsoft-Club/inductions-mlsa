// The browser's API layer (src/lib/api.ts) and CSV parser against the real local stack: argument
// names, returned shapes, error messages and realtime delivery to the web subscriber.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fixture from '../../fixtures/form-export-fake.csv?raw';
import { parseFormExport } from '../../src/csv/parseFormExport.ts';
import { ApiError, createApi, NOT_ALLOWED, type Api } from '../../src/lib/api.ts';
import { notAllowed } from '../../src/lib/notAllowed.ts';
import type { ChannelStatus, Subscribe } from '../../src/lib/realtime.ts';
import { env, makeAccount, service, signIn, uniqueName, waitFor } from './support.ts';

const sortedKeys = (value: object | null | undefined) => Object.keys(value ?? {}).sort();

/** Subscribes, waits until joined, then repeats `poke` until an event arrives (realtime may be warming up). */
async function expectEvent(subscribe: Subscribe, poke: () => Promise<unknown>): Promise<void> {
  const statuses: ChannelStatus[] = [];
  let events = 0;
  const stop = subscribe({ onEvent: () => events++, onStatus: (status) => statuses.push(status) });
  try {
    await waitFor(() => statuses.includes('subscribed'), 15_000);
    const deadline = Date.now() + 20_000;
    while (events === 0) {
      if (Date.now() > deadline) throw new Error(`No realtime event (statuses: ${statuses.join(', ')})`);
      await poke();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    stop();
  }
}

describe('web API layer', () => {
  const accountIds: string[] = [];
  let qm: Api;
  let panelist: Api;
  let projector: Api;
  let inductionId: string;
  let displayKey: string;
  let panelId: string | undefined;
  let interviewId: string | undefined;

  beforeAll(async () => {
    const names = { qm: uniqueName('web_qm'), panelist: uniqueName('web_pan') };
    accountIds.push(await makeAccount(names.qm, 'queue_manager'), await makeAccount(names.panelist, 'panelist'));
    qm = createApi(await signIn(names.qm));
    panelist = createApi(await signIn(names.panelist));
    projector = createApi(createClient(env.url, env.anonKey, { auth: { persistSession: false } }));
    inductionId = (await qm.boardSnapshot()).induction.id;
    const induction = await service.from('inductions').select('display_key').eq('is_active', true).single();
    if (induction.error) throw induction.error;
    displayKey = induction.data.display_key;
  });

  afterAll(async () => {
    if (interviewId) await qm.endInterview(interviewId).catch(() => undefined);
    if (panelId) await qm.deletePanel(panelId).catch(() => undefined);
    for (const id of accountIds) await service.auth.admin.deleteUser(id);
  });

  it('imports the fake form export through the browser parser', async () => {
    const parsed = parseFormExport(fixture);
    if (!parsed.ok) throw new Error(parsed.error);
    const result = await qm.importCandidates(parsed.rows);

    expect(sortedKeys(result)).toEqual(['added', 'flagged', 'updated']);
    expect(result.flagged).toContainEqual({ reg_number: '', name: 'No Reg Person', reason: 'Missing registration number; row skipped' });
    expect(result.flagged).toContainEqual({
      reg_number: '2099101', name: 'Ali Raza', reason: 'Duplicate submission (2 responses); kept the latest',
    });

    const candidates = await qm.listCandidates(inductionId);
    const byReg = (reg: string) => candidates.find((c) => c.reg_number === reg);
    expect(sortedKeys(byReg('2099102'))).toEqual(['full_name', 'id', 'number', 'reg_number', 'status']);
    expect(byReg('2099102')?.full_name).toBe('عائشہ خان'); // ' 2099 102 ' was normalised by the server
    expect(byReg('2099103')?.full_name).toBe("Zara O'Brien-Khan");

    const ali = await service.from('candidates').select('phone, submitted_at, answers').eq('reg_number', '2099101').single();
    if (ali.error) throw ali.error;
    expect(ali.data.phone).toBe('03001234599'); // data from the latest response
    expect(Date.parse(ali.data.submitted_at)).toBe(Date.parse('2026-09-20T10:15:02+05:00')); // time of the earliest
    expect(ali.data.answers.general[0].q).toBe('What motivated you to join Microsoft Club?');
  });

  it('runs a candidate through the queue and returns the shapes the screens use', async () => {
    panelId = await qm.addPanel();
    const reg = `WEB${Date.now()}`;
    await qm.importCandidates([{
      submitted_at: new Date().toISOString(), reg_number: reg, full_name: 'Web Api Tester', email: '', account_email: '',
      phone: '', department: '', batch: '', preferences: ['', '', '', ''],
      answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [] },
    }]);
    const candidate = (await qm.listCandidates(inductionId)).find((c) => c.reg_number === reg);
    if (!candidate) throw new Error('imported candidate not found');
    expect(candidate.status).toBe('registered');

    await qm.checkIn(candidate.id);
    let board = await qm.boardSnapshot();
    expect(sortedKeys(board)).toEqual(['counts', 'form_warnings', 'induction', 'panels', 'pool', 'server_time']);
    expect(sortedKeys(board.induction)).toEqual(['id', 'name', 'results_published', 'target_interview_minutes']);
    expect(sortedKeys(board.counts)).toEqual(['interviewed', 'interviewing', 'registered', 'waiting']);
    const pooled = board.pool.find((e) => e.candidate_id === candidate.id);
    expect(sortedKeys(pooled)).toEqual(['candidate_id', 'checked_in_at', 'has_photo', 'name', 'number', 'position', 'reg_number', 'skip_count']);

    await qm.moveCandidate(candidate.id, panelId, null);
    board = await qm.boardSnapshot();
    const panel = board.panels.find((p) => p.id === panelId);
    expect(sortedKeys(panel)).toEqual(['current', 'id', 'is_default', 'lane', 'last_ended', 'name', 'panelists']);
    expect(panel?.lane.map((e) => e.candidate_id)).toEqual([candidate.id]);

    await panelist.setMyPanel(panelId); // send in lines people up for a panel nobody is sitting in
    interviewId = await qm.sendIn(candidate.id, panelId);
    board = await qm.boardSnapshot();
    const busy = board.panels.find((p) => p.id === panelId);
    expect(sortedKeys(busy?.current)).toEqual(['candidate_id', 'interview_id', 'name', 'number', 'reg_number', 'started_at']);
    expect(busy?.current?.interview_id).toBe(interviewId);

    const display = await projector.displaySnapshot(displayKey);
    expect(sortedKeys(display)).toEqual(['induction_name', 'panels', 'server_time', 'target_interview_minutes', 'waiting']);
    const tile = display?.panels.find((p) => p.id === panelId);
    expect(sortedKeys(tile)).toEqual(['current', 'id', 'lined_up', 'name']);
    expect(tile?.current).toMatchObject({ number: candidate.number, name: 'Web Api Tester' });
    expect(await projector.displaySnapshot('not-the-key')).toBeNull();

    await qm.endInterview(interviewId);
    board = await qm.boardSnapshot();
    const ended = board.panels.find((p) => p.id === panelId);
    expect(ended?.current).toBeNull();
    expect(sortedKeys(ended?.last_ended)).toEqual(['candidate_id', 'ended_at', 'interview_id', 'name', 'number', 'ready_at']);
    expect(ended?.last_ended?.ready_at).toBeNull(); // wrapping up until a panelist says ready
    interviewId = undefined;

    await expect(qm.sendIn(candidate.id, panelId)).rejects.toEqual(new ApiError(`Candidate #${candidate.number} is not waiting`));
    await qm.deletePanel(panelId);
    panelId = undefined;
  });

  it('turns permission errors into "Not allowed" and announces them', async () => {
    let heard = 0;
    const stop = notAllowed.subscribe(() => heard++);
    await expect(panelist.addPanel()).rejects.toEqual(new ApiError(NOT_ALLOWED));
    stop();
    expect(heard).toBe(1);
    expect(Date.parse(await projector.serverNow())).not.toBeNaN();
  });

  it('delivers board and projector events to the web subscriber', async () => {
    const poke = () => qm.importCandidates([]); // a no-op import still broadcasts
    await expectEvent(qm.subscribeBoard(), poke);
    await expectEvent(projector.subscribeDisplay(displayKey), poke);
  });

  it('joins again when a screen re-subscribes to a topic straight after leaving it', async () => {
    for (const [name, subscribe] of [
      ['board', () => qm.subscribeBoard()],
      ['projector', () => projector.subscribeDisplay(displayKey)],
    ] as const) {
      const first: ChannelStatus[] = [];
      const stopFirst = subscribe()({ onEvent: () => {}, onStatus: (status) => first.push(status) });
      await waitFor(() => first.includes('subscribed'), 15_000);
      stopFirst(); // e.g. React remounting the screen: leave, then subscribe again at once
      const again: ChannelStatus[] = [];
      const stopAgain = subscribe()({ onEvent: () => {}, onStatus: (status) => again.push(status) });
      try {
        await waitFor(() => again.includes('subscribed'), 10_000).catch(() => {
          throw new Error(`${name}: never joined again (statuses: ${again.join(', ') || 'none'})`);
        });
      } finally {
        stopAgain();
      }
    }
  });
});
