import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { env, makeAccount, service, signIn, uniqueName, waitFor } from './support.ts';

type Payload = Record<string, any>;

async function listen(
  client: SupabaseClient, topic: string, isPrivate: boolean, event: string, sink: Payload[],
): Promise<RealtimeChannel> {
  if (isPrivate) await client.realtime.setAuth();
  return new Promise((resolve, reject) => {
    const channel = client
      .channel(topic, { config: { private: isPrivate } })
      .on('broadcast', { event }, (message) => sink.push(message.payload))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') resolve(channel);
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status));
      });
  });
}

describe('realtime delivery', () => {
  const accountIds: string[] = [];
  let qm: SupabaseClient;
  let admin: SupabaseClient;
  let panelistA: SupabaseClient;
  let panelistB: SupabaseClient;
  let projector: SupabaseClient;
  let displayKey: string;
  let panelId: string;
  let candidateId: string;
  let candidateNumber: number;
  let interviewId: string;

  beforeAll(async () => {
    const names = { qm: uniqueName('rt_qm'), admin: uniqueName('rt_ad'), a: uniqueName('rt_pa'), b: uniqueName('rt_pb') };
    accountIds.push(
      await makeAccount(names.qm, 'queue_manager'),
      await makeAccount(names.admin, 'admin'),
      await makeAccount(names.a, 'panelist'),
      await makeAccount(names.b, 'panelist'),
    );
    [qm, admin, panelistA, panelistB] = await Promise.all([signIn(names.qm), signIn(names.admin), signIn(names.a), signIn(names.b)]);
    projector = createClient(env.url, env.anonKey, { auth: { persistSession: false } });

    const induction = await service.from('inductions').select('display_key').eq('is_active', true).single();
    if (induction.error) throw induction.error;
    displayKey = induction.data.display_key;

    // Right after `supabase start`/`db reset` the realtime service needs a few seconds before it
    // accepts sockets and relays database broadcasts; wait until a broadcast actually arrives.
    const deadline = Date.now() + 30_000;
    for (;;) {
      const seen: Payload[] = [];
      try {
        await listen(projector, `display:${displayKey}`, false, 'snapshot', seen);
        await qm.rpc('import_candidates', { p_rows: [] }); // a no-op import still broadcasts
        await waitFor(() => seen.length > 0, 2000);
        await projector.removeAllChannels();
        break;
      } catch (error) {
        await projector.removeAllChannels();
        if (Date.now() > deadline) throw new Error(`Realtime never started delivering broadcasts: ${error}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // A fresh panel keeps this test independent of whatever else is on the board.
    const panel = await admin.rpc('add_panel');
    if (panel.error) throw panel.error;
    panelId = panel.data;
    expect((await panelistA.rpc('set_my_panel', { p_panel_id: panelId })).error).toBeNull(); // send in lines people up for a panel nobody is sitting in

    const reg = uniqueName('RT').toUpperCase();
    const imported = await qm.rpc('import_candidates', {
      p_rows: [{ reg_number: reg, full_name: 'Realtime Tester', submitted_at: new Date().toISOString(), preferences: [], answers: {} }],
    });
    if (imported.error) throw imported.error;
    const candidate = await qm.from('candidates').select('id, number').eq('reg_number', reg).single();
    if (candidate.error) throw candidate.error;
    candidateId = candidate.data.id;
    candidateNumber = candidate.data.number;
  });

  afterAll(async () => {
    await Promise.all([qm, admin, panelistA, panelistB, projector].map((c) => c?.removeAllChannels()));
    if (interviewId) {
      await qm.rpc('end_interview', { p_interview_id: interviewId });
      await service.from('messages').delete().eq('interview_id', interviewId);
    }
    if (panelId) await admin.rpc('delete_panel', { p_panel_id: panelId });
    for (const id of accountIds) await service.auth.admin.deleteUser(id);
  });

  it('pushes queue changes to the staff board and the projector', async () => {
    const board: Payload[] = [];
    const display: Payload[] = [];
    await listen(qm, 'board', true, 'changed', board);
    await listen(projector, `display:${displayKey}`, false, 'snapshot', display);

    const started = Date.now();
    expect((await qm.rpc('check_in', { p_candidate_id: candidateId })).error).toBeNull();
    expect((await qm.rpc('move_candidate', { p_candidate_id: candidateId, p_panel_id: panelId, p_position: null })).error).toBeNull();
    const sendIn = await qm.rpc('send_in', { p_candidate_id: candidateId, p_panel_id: panelId });
    expect(sendIn.error).toBeNull();
    interviewId = sendIn.data;

    await waitFor(() => board.length >= 3);
    const tile = await waitFor(() =>
      display
        .map((snapshot) => snapshot.panels.find((panel: Payload) => panel.id === panelId))
        .find((panel) => panel?.current?.number === candidateNumber),
    );
    expect(tile.current.name).toBe('Realtime Tester');
    expect(Object.keys(tile.current).sort()).toEqual(['name', 'number', 'started_at']);
    console.info(`projector showed the send-in ${Date.now() - started} ms after the first action`);
  });

  it('delivers chat messages to panelists but not to the queue manager', async () => {
    const topic = `interview:${interviewId}`;
    const panelistMessages: Payload[] = [];
    const qmMessages: Payload[] = [];
    await listen(panelistA, topic, true, 'message', panelistMessages);
    await listen(qm, topic, true, 'message', qmMessages).catch(() => undefined); // may be refused outright

    const posted = await panelistB.rpc('post_message', { p_interview_id: interviewId, p_body: 'Ask about Docker' });
    expect(posted.error).toBeNull();

    const received = await waitFor(() => panelistMessages[0]);
    expect(received.body).toBe('Ask about Docker');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(qmMessages).toHaveLength(0);
  });
});
