// The Plan 3 API calls against the real local stack: panelist chat and evaluations, results,
// decisions, publishing, settings and account management (needs `npm run functions:serve`).
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, createApi, NOT_ALLOWED, type Api } from '../../src/lib/api.ts';
import type { ChannelStatus, Subscribe } from '../../src/lib/realtime.ts';
import { env, makeAccount, service, signIn, TEST_PASSWORD, uniqueName, waitFor } from './support.ts';

const sortedKeys = (value: object | null | undefined) => Object.keys(value ?? {}).sort();

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

describe('panelist, admin and results API', () => {
  const accountIds: string[] = [];
  const names = { qm: uniqueName('p3_qm'), a: uniqueName('p3_pa'), b: uniqueName('p3_pb'), admin: uniqueName('p3_ad') };
  const ids: Record<string, string> = {};
  let qm: Api;
  let panelistA: Api;
  let panelistB: Api;
  let admin: Api;
  let anon: Api;
  let inductionId: string;
  let panelId: string | undefined;
  let interviewId: string | undefined;
  let candidateId: string;
  let reg: string;
  let original: { name: string; target_interview_minutes: number };

  beforeAll(async () => {
    ids.qm = await makeAccount(names.qm, 'queue_manager');
    ids.a = await makeAccount(names.a, 'panelist');
    ids.b = await makeAccount(names.b, 'panelist');
    ids.admin = await makeAccount(names.admin, 'admin');
    accountIds.push(ids.qm, ids.a, ids.b, ids.admin);
    [qm, panelistA, panelistB, admin] = (await Promise.all([signIn(names.qm), signIn(names.a), signIn(names.b), signIn(names.admin)])).map(createApi);
    anon = createApi(createClient(env.url, env.anonKey, { auth: { persistSession: false } }));
    inductionId = (await qm.boardSnapshot()).induction.id;
    original = await admin.induction();

    // One candidate, sent into a panel of their own.
    panelId = await qm.addPanel();
    reg = `P3${Date.now()}`;
    await qm.importCandidates([{
      submitted_at: new Date().toISOString(), reg_number: reg, full_name: 'Plan Three Tester', email: '', account_email: '',
      phone: '03000000000', department: 'Computer Science', batch: 'B35', preferences: ['Dev Team', '', '', ''],
      answers: { general: [{ q: 'Why MLSA?', a: 'To learn.' }], dev: [], logikal: [], lnd: [], marketing: [] },
    }]);
    candidateId = (await qm.listCandidates(inductionId)).find((c) => c.reg_number === reg)!.id;
    await qm.checkIn(candidateId);
    interviewId = await qm.sendIn(candidateId, panelId);
  });

  afterAll(async () => {
    await admin.setResultsPublished(false).catch(() => undefined);
    await admin.setDecision(candidateId, 'undecided').catch(() => undefined);
    await admin.updateSettings(original.name, original.target_interview_minutes).catch(() => undefined);
    if (interviewId) await qm.endInterview(interviewId).catch(() => undefined);
    if (panelId) await qm.deletePanel(panelId).catch(() => undefined);
    for (const id of accountIds) await service.auth.admin.deleteUser(id);
  });

  it('lets panelists join a panel, read the application, chat and evaluate', async () => {
    await panelistA.setMyPanel(panelId!);
    const board = await panelistA.boardSnapshot();
    expect(board.panels.find((p) => p.id === panelId)?.panelists.map((p) => p.id)).toContain(ids.a);

    const candidate = await panelistA.candidate(candidateId);
    expect(sortedKeys(candidate)).toEqual([
      'account_email', 'answers', 'batch', 'checked_in_at', 'decision', 'department', 'email', 'full_name', 'id',
      'number', 'phone', 'preferences', 'reg_number', 'status', 'submitted_at',
    ]);
    expect(candidate.answers.general?.[0]).toEqual({ q: 'Why MLSA?', a: 'To learn.' });
    await expect(panelistA.candidate('00000000-0000-0000-0000-000000000000')).rejects.toEqual(new ApiError('Candidate not found'));

    const [interview] = await panelistA.panelInterviews(panelId!);
    expect(sortedKeys(interview)).toEqual(['candidate', 'ended_at', 'id', 'started_at', 'status']);
    expect(interview).toMatchObject({ id: interviewId, status: 'in_progress', candidate: { id: candidateId, full_name: 'Plan Three Tester' } });

    const criteria = await panelistA.criteria(inductionId);
    expect(criteria.map((c) => c.key)).toEqual([
      'communication', 'confidence_attitude', 'teamwork', 'commitment', 'problem_solving', 'fit_dev', 'fit_logikal', 'fit_lnd', 'fit_marketing',
    ]);
    expect(sortedKeys(criteria[0])).toEqual(['category', 'key', 'label', 'sort_order']);

    const id = crypto.randomUUID();
    const message = await panelistA.postMessage(interviewId!, 'Strong answers on teamwork', id);
    expect(sortedKeys(message)).toEqual(['author_id', 'author_name', 'body', 'created_at', 'id', 'interview_id']);
    expect(await panelistA.postMessage(interviewId!, 'Strong answers on teamwork', id)).toEqual(message); // a retry doesn't post twice
    expect((await panelistB.interviewMessages(interviewId!)).map((m) => m.body)).toEqual(['Strong answers on teamwork']);

    expect(await panelistB.evaluationCount(interviewId!)).toBe(0);
    await panelistA.submitEvaluation(interviewId!, { communication: 4, teamwork: 5, fit_dev: 5 }, 'strong_yes', 'Great fit');
    expect(await panelistB.evaluationCount(interviewId!)).toBe(1);
    const [mine] = await panelistA.myEvaluations(ids.a, inductionId);
    expect(sortedKeys(mine)).toEqual(['comments', 'interview', 'interview_id', 'recommendation', 'scores', 'updated_at']);
    expect(mine).toMatchObject({ interview_id: interviewId, recommendation: 'strong_yes', scores: { communication: 4, teamwork: 5, fit_dev: 5 } });
    // Enough to list it in the panelist's history and open it again, whichever panel they are in now.
    expect(mine.interview).toEqual({
      id: interviewId, status: 'in_progress', started_at: expect.any(String), ended_at: null,
      panel: { name: board.panels.find((p) => p.id === panelId)!.name },
      candidate: { id: candidateId, number: candidate.number, full_name: 'Plan Three Tester' },
    });
    expect(await panelistB.myEvaluations(ids.b, inductionId)).toEqual([]);
    expect(await qm.interviewMessages(interviewId!).catch((e: Error) => e.message)).toBe(NOT_ALLOWED);

    await expectEvent(panelistB.subscribeInterview(interviewId!), () => panelistA.postMessage(interviewId!, 'ping', crypto.randomUUID()));
  });

  it('gives admins the results, the full record and the exports, and publishes the selected list', async () => {
    await qm.endInterview(interviewId!);
    const row = (await admin.resultsTable()).find((r) => r.candidate_id === candidateId)!;
    expect(sortedKeys(row)).toEqual([
      'batch', 'candidate_id', 'criteria_avgs', 'decision', 'department', 'evaluation_count', 'full_name', 'general_avg',
      'number', 'panels', 'preferences', 'recommendations', 'reg_number', 'status',
    ]);
    expect(row).toMatchObject({ evaluation_count: 1, general_avg: 4.5, recommendations: { strong_yes: 1 }, criteria_avgs: { fit_dev: 5 } });
    const panelName = (await admin.boardSnapshot()).panels.find((p) => p.id === panelId)!.name;
    expect(row.panels).toEqual([panelName]);

    const record = await admin.candidateRecord(candidateId);
    expect(sortedKeys(record)).toEqual(['candidate', 'interviews']);
    expect(sortedKeys(record.interviews[0])).toEqual(['ended_at', 'evaluations', 'id', 'messages', 'panel_name', 'started_at', 'status']);
    expect(sortedKeys(record.interviews[0].evaluations[0])).toEqual(['comments', 'panelist_name', 'recommendation', 'scores', 'submitted_at', 'updated_at']);
    const bodies = record.interviews[0].messages.map((m) => m.body);
    expect(bodies[0]).toBe('Strong answers on teamwork');
    expect(bodies.slice(1).every((body) => body === 'ping')).toBe(true); // expectEvent pokes until an event arrives

    const exported = (await admin.evaluationsExport()).filter((e) => e.reg_number === reg);
    expect(exported).toHaveLength(1);
    expect(sortedKeys(exported[0])).toEqual(['comments', 'full_name', 'number', 'panel', 'panelist', 'recommendation', 'reg_number', 'scores', 'submitted_at', 'updated_at']);

    await admin.setDecision(candidateId, 'selected');
    expect(await anon.publishedResults()).not.toContainEqual({ full_name: 'Plan Three Tester', reg_number: reg });
    await admin.setResultsPublished(true);
    expect((await admin.induction()).results_published).toBe(true);
    expect(await anon.publishedResults()).toContainEqual({ full_name: 'Plan Three Tester', reg_number: reg });
    await expect(panelistA.submitEvaluation(interviewId!, {}, 'no', '')).rejects.toEqual(
      new ApiError('Results are published; evaluations are locked'),
    );
    await admin.setResultsPublished(false);
    interviewId = undefined;
  });

  it("leaves interviews that were sent back out of a panelist's evaluations", async () => {
    const [evaluation] = await panelistA.myEvaluations(ids.a, inductionId);
    await service.from('interviews').update({ status: 'cancelled' }).eq('id', evaluation.interview_id);
    expect(await panelistA.myEvaluations(ids.a, inductionId)).toEqual([]);
  });

  it('manages accounts through the edge function, for admins only', async () => {
    const username = uniqueName('p3_new');
    await admin.manageAccount({ action: 'create', username, displayName: 'New Panelist', role: 'panelist', password: TEST_PASSWORD });
    const created = (await admin.listAccounts()).find((a) => a.username === username)!;
    accountIds.push(created.id);
    expect(sortedKeys(created)).toEqual(['current_panel_id', 'display_name', 'id', 'is_active', 'role', 'username']);
    await expect(
      admin.manageAccount({ action: 'create', username, displayName: 'Again', role: 'panelist', password: TEST_PASSWORD }),
    ).rejects.toEqual(new ApiError('Username already taken'));

    await admin.manageAccount({ action: 'reset_password', userId: created.id, password: 'a-new-password' });
    await expect(signIn(username, 'a-new-password')).resolves.toBeTruthy();
    await admin.manageAccount({ action: 'set_active', userId: created.id, active: false });
    await expect(signIn(username, 'a-new-password')).rejects.toThrow();
    expect((await admin.listAccounts()).find((a) => a.id === created.id)?.is_active).toBe(false);
    await admin.manageAccount({ action: 'set_active', userId: created.id, active: true });

    await expect(qm.manageAccount({ action: 'set_active', userId: created.id, active: false })).rejects.toEqual(new ApiError(NOT_ALLOWED));
  });

  it('changes settings and the projector key', async () => {
    await admin.updateSettings('Fall 2026 (test)', 20);
    expect(await admin.induction()).toMatchObject({ name: 'Fall 2026 (test)', target_interview_minutes: 20 });
    const oldKey = await admin.getDisplayKey();
    try {
      const newKey = await admin.regenerateDisplayKey();
      expect(newKey).not.toBe(oldKey);
      expect(await anon.displaySnapshot(oldKey)).toBeNull();
      expect((await anon.displaySnapshot(newKey))?.induction_name).toBe('Fall 2026 (test)');
    } finally {
      // Put the old key back, so a projector left open on the local link keeps working.
      await service.from('inductions').update({ display_key: oldKey }).eq('is_active', true);
    }
    expect(await admin.getDisplayKey()).toBe(oldKey);
  });
});
