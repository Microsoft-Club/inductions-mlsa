// Race-condition harness (local stack only). Fires conflicting actions at the same instant from
// different signed-in accounts through the app's own API layer, then checks the data is consistent.
// Run: npm run stress:races [-- rounds]   (default 20 rounds per scenario; needs db:start)
import { createApi, type Api } from '../../src/lib/api.ts';
import { makeAccount, signIn, uniqueName } from '../integration/support.ts';
import { sql } from './db.ts';

const ROUNDS = Number(process.argv[2] ?? 20);
const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
let regSeq = 0;

type Outcome = { ok: true; value: unknown } | { ok: false; error: string };
async function settle(...calls: Array<() => Promise<unknown>>): Promise<Outcome[]> {
  // Start every call in the same tick so they really overlap at the server.
  const results = await Promise.allSettled(calls.map((call) => call()));
  return results.map((r) => (r.status === 'fulfilled' ? { ok: true, value: r.value } : { ok: false, error: (r.reason as Error).message }));
}
const oks = (outcomes: Outcome[]) => outcomes.filter((o) => o.ok).length;
const errors = (outcomes: Outcome[]) => outcomes.filter((o): o is { ok: false; error: string } => !o.ok).map((o) => o.error);

// ---------------------------------------------------------------- results
const report: Record<string, { rounds: number; problems: string[]; outcomes: Record<string, number> }> = {};
function record(scenario: string, outcomeKey: string, problem?: string) {
  const entry = (report[scenario] ??= { rounds: 0, problems: [], outcomes: {} });
  entry.outcomes[outcomeKey] = (entry.outcomes[outcomeKey] ?? 0) + 1;
  if (problem && entry.problems.length < 8) entry.problems.push(problem);
}
const describe = (outcomes: Outcome[]) => outcomes.map((o) => (o.ok ? 'ok' : `err:${o.error.replace(/#\d+/g, '#n').replace(/Panel \d+/g, 'Panel X').slice(0, 60)}`)).sort().join(' + ');

// ---------------------------------------------------------------- invariants (whole database)
const INVARIANTS: Array<[string, string]> = [
  ['two in-progress interviews for one candidate', `select c.number from public.candidates c join public.interviews i on i.candidate_id = c.id and i.status = 'in_progress' group by c.number having count(*) > 1`],
  ['two in-progress interviews in one panel', `select p.name from public.panels p join public.interviews i on i.panel_id = p.id and i.status = 'in_progress' group by p.name having count(*) > 1`],
  ['interviewing without an in-progress interview', `select c.number from public.candidates c where c.status = 'interviewing' and not exists (select 1 from public.interviews i where i.candidate_id = c.id and i.status = 'in_progress')`],
  ['in-progress interview but candidate not interviewing', `select c.number || ':' || c.status from public.candidates c join public.interviews i on i.candidate_id = c.id and i.status = 'in_progress' where c.status <> 'interviewing'`],
  ['waiting without a queue entry', `select c.number from public.candidates c where c.status = 'waiting' and not exists (select 1 from public.queue_entries q where q.candidate_id = c.id)`],
  ['queue entry but not waiting', `select c.number || ':' || c.status from public.queue_entries q join public.candidates c on c.id = q.candidate_id where c.status <> 'waiting'`],
  // P3… candidates come from tests/integration/web-panel-admin.test.ts, which cancels an interview by hand on purpose.
  ['interviewed without an ended interview', `select c.number from public.candidates c where c.status = 'interviewed' and c.reg_number not like 'P3%' and not exists (select 1 from public.interviews i where i.candidate_id = c.id and i.status = 'ended')`],
  ['lane positions not 1..n', `select coalesce(q.panel_id::text, 'pool') || ' has ' || string_agg(q.position::text, ',' order by q.position) from public.queue_entries q group by q.induction_id, q.panel_id having min(q.position) <> 1 or max(q.position) <> count(*) or count(distinct q.position) <> count(*)`],
  ['in-progress interview in a deleted panel', `select p.name from public.panels p join public.interviews i on i.panel_id = p.id and i.status = 'in_progress' where p.deleted_at is not null`],
  ['lined up for a deleted panel', `select p.name from public.panels p join public.queue_entries q on q.panel_id = p.id where p.deleted_at is not null`],
  ['seated in a deleted panel', `select pr.username from public.profiles pr join public.panels p on p.id = pr.current_panel_id where p.deleted_at is not null`],
  ['ready_at on an interview that is not ended', `select id from public.interviews where ready_at is not null and status <> 'ended'`],
  ['duplicate candidate number', `select number from public.candidates group by induction_id, number having count(*) > 1`],
  ['duplicate reg number', `select reg_number from public.candidates group by induction_id, reg_number having count(*) > 1`],
];
function checkInvariants(after: string) {
  const broken: string[] = [];
  for (const [name, query] of INVARIANTS) {
    const rows = sql(query);
    if (rows) broken.push(`${name}: ${rows.split('\n').slice(0, 5).join('; ')}`);
  }
  if (broken.length) record('INVARIANTS', 'broken', `after ${after}: ${broken.join(' | ')}`);
  else record('INVARIANTS', 'ok');
  return broken;
}

// ---------------------------------------------------------------- setup
console.log(`race harness run ${RUN}, ${ROUNDS} rounds per scenario`);
async function person(role: 'queue_manager' | 'panelist' | 'admin') {
  const username = uniqueName(`rc_${role.slice(0, 3)}`);
  const id = await makeAccount(username, role);
  const api = createApi(await signIn(username));
  return { username, id, api };
}
const qmA = await person('queue_manager');
const qmB = await person('queue_manager');
const admin = await person('admin');
const pans = [await person('panelist'), await person('panelist'), await person('panelist'), await person('panelist')];
const inductionId = (await qmA.api.boardSnapshot()).induction.id;

async function freshCandidates(n: number, checkIn = true): Promise<string[]> {
  const regs = Array.from({ length: n }, () => `RC${RUN}${String(++regSeq).padStart(4, '0')}`);
  await qmA.api.importCandidates(regs.map((reg) => ({
    submitted_at: new Date().toISOString(), reg_number: reg, full_name: `Race ${reg}`, email: '', account_email: '',
    phone: '', department: '', batch: '', preferences: ['', '', '', ''],
    answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [] },
  })) as never);
  // Looked up by reg number in the database: the candidate list stops at 1,000 rows, and this database fills up.
  const byReg = new Map(sql(`select reg_number, id from public.candidates where reg_number in (${regs.map((r) => `'${r}'`).join(',')})`).split('\n').map((l) => l.split('|') as [string, string]));
  const ids = regs.map((reg) => byReg.get(reg)!);
  if (checkIn) for (const id of ids) await qmA.api.checkIn(id);
  return ids;
}
const panelsMade: string[] = [];
async function newPanel(...seated: Array<{ api: Api }>): Promise<string> {
  const id = await qmA.api.addPanel();
  panelsMade.push(id);
  for (const p of seated) await p.api.setMyPanel(id);
  return id;
}
async function liveInterview(candidateId: string): Promise<string | null> {
  const board = await qmA.api.boardSnapshot();
  return board.panels.find((p) => p.current?.candidate_id === candidateId)?.current?.interview_id ?? null;
}
const endedAgo = (interviewId: string, seconds: number) => sql(`update public.interviews set ended_at = clock_timestamp() - interval '${seconds} seconds' where id = '${interviewId}'`);
const status = (candidateId: string) => sql(`select status from public.candidates where id = '${candidateId}'`);

async function scenario(name: string, body: (round: number) => Promise<void>) {
  const started = Date.now();
  for (let round = 0; round < ROUNDS; round++) {
    report[name] ??= { rounds: 0, problems: [], outcomes: {} };
    report[name].rounds++;
    try {
      await body(round);
    } catch (e) {
      record(name, 'harness-error', `round ${round}: ${(e as Error).message}`);
    }
  }
  checkInvariants(name);
  console.log(`  ${name}: ${Date.now() - started} ms`, JSON.stringify(report[name].outcomes));
}

// ---------------------------------------------------------------- scenarios
await scenario('two desks send different people into one free panel', async () => {
  const panel = await newPanel(pans[0]);
  const [c1, c2] = await freshCandidates(2);
  const out = await settle(() => qmA.api.sendIn(c1, panel), () => qmB.api.sendIn(c2, panel));
  record('two desks send different people into one free panel', describe(out), oks(out) !== 1 ? `expected exactly 1 ok, got ${describe(out)}` : undefined);
  const live = (await liveInterview(c1)) ?? (await liveInterview(c2));
  if (live) await pans[0].api.endInterview(live);
  await pans[0].api.setMyPanel(null);
});

await scenario('two desks send one person into two panels', async () => {
  const p1 = await newPanel(pans[0]);
  const p2 = await newPanel(pans[1]);
  const [c] = await freshCandidates(1);
  const out = await settle(() => qmA.api.sendIn(c, p1), () => qmB.api.sendIn(c, p2));
  record('two desks send one person into two panels', describe(out), oks(out) !== 1 ? `expected exactly 1 ok, got ${describe(out)}` : undefined);
  const live = await liveInterview(c);
  if (live) await qmA.api.endInterview(live);
});

await scenario('two desks check the same person in', async () => {
  const [c] = await freshCandidates(1, false);
  const out = await settle(() => qmA.api.checkIn(c), () => qmB.api.checkIn(c));
  record('two desks check the same person in', describe(out), oks(out) < 1 ? `nobody succeeded: ${describe(out)}` : undefined);
  const entries = sql(`select count(*) from public.queue_entries where candidate_id = '${c}'`);
  if (entries !== '1') record('two desks check the same person in', 'bad', `queue entries = ${entries}`);
});

await scenario('panelist ends while the desk undoes the send-in', async () => {
  const panel = await newPanel(pans[0]);
  const [c] = await freshCandidates(1);
  const interview = (await qmA.api.sendIn(c, panel))!;
  const out = await settle(() => pans[0].api.endInterview(interview), () => qmA.api.undoSendIn(interview));
  const final = status(c);
  const ok = oks(out) === 1 && ((out[0].ok && final === 'interviewed') || (out[1].ok && final === 'waiting'));
  record('panelist ends while the desk undoes the send-in', `${describe(out)} -> ${final}`, ok ? undefined : `${describe(out)} left candidate ${final}`);
  await pans[0].api.setMyPanel(null);
});

await scenario('two panelists press End together', async () => {
  const panel = await newPanel(pans[0], pans[1]);
  const [c] = await freshCandidates(1);
  const interview = (await qmA.api.sendIn(c, panel))!;
  const out = await settle(() => pans[0].api.endInterview(interview), () => pans[1].api.endInterview(interview));
  record('two panelists press End together', describe(out), oks(out) !== 1 ? `expected 1 ok, got ${describe(out)}` : undefined);
});

await scenario('two panelists press Ready together', async () => {
  const panel = await newPanel(pans[0], pans[1]);
  const [c] = await freshCandidates(1);
  const interview = (await qmA.api.sendIn(c, panel))!;
  await pans[0].api.endInterview(interview);
  endedAgo(interview, 20);
  const out = await settle(() => pans[0].api.markPanelReady(interview), () => pans[1].api.markPanelReady(interview));
  const readyBy = sql(`select count(*) from public.interviews where id = '${interview}' and ready_at is not null and ready_by is not null`);
  record('two panelists press Ready together', describe(out), oks(out) !== 2 || readyBy !== '1' ? `${describe(out)}, ready rows ${readyBy}` : undefined);
});

await scenario('Ready while the desk sends the next person in', async () => {
  const panel = await newPanel(pans[0]);
  const [c1, c2] = await freshCandidates(2);
  const first = (await qmA.api.sendIn(c1, panel))!;
  await pans[0].api.endInterview(first);
  endedAgo(first, 20);
  const out = await settle(() => pans[0].api.markPanelReady(first), () => qmA.api.sendIn(c2, panel));
  record('Ready while the desk sends the next person in', describe(out), out[1].ok ? undefined : `send in failed: ${describe(out)}`);
  const live = await liveInterview(c2);
  if (live) await qmA.api.endInterview(live);
});

await scenario('Reopen while the desk sends the next person in', async () => {
  const panel = await newPanel(pans[0]);
  const [c1, c2] = await freshCandidates(2);
  const first = (await qmA.api.sendIn(c1, panel))!;
  await pans[0].api.endInterview(first);
  const out = await settle(() => qmA.api.reopenInterview(first), () => qmB.api.sendIn(c2, panel));
  record('Reopen while the desk sends the next person in', describe(out), oks(out) !== 1 ? `expected exactly 1 ok, got ${describe(out)}` : undefined);
  for (const c of [c1, c2]) {
    const live = await liveInterview(c);
    if (live) await qmA.api.endInterview(live);
  }
});

await scenario('two desks shuffle one lane at once', async () => {
  const panel = await newPanel();
  const ids = await freshCandidates(8);
  for (const id of ids) await qmA.api.moveCandidate(id, panel, null);
  const ops: Array<() => Promise<unknown>> = [];
  for (let i = 0; i < 30; i++) {
    const who = i % 2 ? qmA : qmB;
    const id = ids[Math.floor(Math.random() * ids.length)];
    const r = Math.random();
    if (r < 0.5) ops.push(() => who.api.moveCandidate(id, panel, 1 + Math.floor(Math.random() * 8)));
    else if (r < 0.7) ops.push(() => who.api.skipCandidate(id));
    else if (r < 0.85) ops.push(() => who.api.moveCandidate(id, null, 1));
    else ops.push(() => who.api.moveCandidate(id, panel, null));
  }
  const out = await settle(...ops);
  const errs = errors(out);
  record('two desks shuffle one lane at once', errs.length ? `errors:${errs.length}` : 'all ok', errs.length ? errs.slice(0, 3).join(' / ') : undefined);
  const count = sql(`select count(*) from public.queue_entries where candidate_id in (${ids.map((i) => `'${i}'`).join(',')})`);
  if (count !== '8') record('two desks shuffle one lane at once', 'lost', `queue entries for the 8 = ${count}`);
});

await scenario('delete a panel while the desk sends someone into it', async () => {
  const panel = await newPanel(pans[2]);
  const [c] = await freshCandidates(1);
  await qmA.api.moveCandidate(c, panel, 1);
  const out = await settle(() => admin.api.deletePanel(panel), () => qmB.api.sendIn(c, panel));
  record('delete a panel while the desk sends someone into it', `${describe(out)} -> ${status(c)}`);
  const live = await liveInterview(c);
  if (live) await qmA.api.endInterview(live);
  await pans[2].api.setMyPanel(null).catch(() => {});
});

await scenario('panelist hops panels while the desk sends in', async () => {
  const panel = await newPanel();
  const [c] = await freshCandidates(1);
  const out = await settle(
    () => pans[3].api.setMyPanel(panel),
    () => qmA.api.sendIn(c, panel),
    () => pans[3].api.setMyPanel(null),
  );
  const s = status(c);
  record('panelist hops panels while the desk sends in', `${describe(out)} -> ${s}`);
  const live = await liveInterview(c);
  if (live) await qmA.api.endInterview(live);
  await pans[3].api.setMyPanel(null);
});

await scenario('admin removes a panelist while they press End', async () => {
  const panel = await newPanel(pans[1]);
  const [c] = await freshCandidates(1);
  const interview = (await qmA.api.sendIn(c, panel))!;
  const out = await settle(() => admin.api.removeFromPanel(pans[1].id), () => pans[1].api.endInterview(interview));
  record('admin removes a panelist while they press End', describe(out), out[0].ok ? undefined : `remove failed: ${describe(out)}`);
  const live = await liveInterview(c);
  if (live) await qmA.api.endInterview(live);
});

await scenario('one panelist submits the same evaluation from two tabs', async () => {
  const panel = await newPanel(pans[0]);
  const [c] = await freshCandidates(1);
  const interview = (await qmA.api.sendIn(c, panel))!;
  await pans[0].api.endInterview(interview);
  const out = await settle(
    () => pans[0].api.submitEvaluation(interview, { communication: 4 }, 'yes', 'tab one'),
    () => pans[0].api.submitEvaluation(interview, { communication: 2 }, 'no', 'tab two'),
  );
  const rows = sql(`select count(*) from public.evaluations where interview_id = '${interview}'`);
  record('one panelist submits the same evaluation from two tabs', describe(out), oks(out) !== 2 || rows !== '1' ? `${describe(out)}, rows ${rows}` : undefined);
});

await scenario('the desk undoes a check-in while sending the person in', async () => {
  const panel = await newPanel(pans[0]);
  const [c] = await freshCandidates(1);
  await qmA.api.moveCandidate(c, panel, 1);
  const out = await settle(() => qmA.api.undoCheckIn(c), () => qmB.api.sendIn(c, panel));
  record('the desk undoes a check-in while sending the person in', `${describe(out)} -> ${status(c)}`, oks(out) !== 1 ? `expected exactly 1 ok, got ${describe(out)}` : undefined);
  const live = await liveInterview(c);
  if (live) await qmA.api.endInterview(live);
  await pans[0].api.setMyPanel(null);
});

await scenario('two desks add a panel at once', async () => {
  const out = await settle(() => qmA.api.addPanel(), () => qmB.api.addPanel());
  for (const o of out) if (o.ok) panelsMade.push(o.value as string);
  const dupes = sql(`select name from public.panels where induction_id = '${inductionId}' and deleted_at is null group by name having count(*) > 1`);
  record('two desks add a panel at once', describe(out), dupes ? `duplicate panel names: ${dupes}` : undefined);
});

await scenario('two desks import overlapping spreadsheets', async () => {
  const regs = Array.from({ length: 6 }, () => `RC${RUN}${String(++regSeq).padStart(4, '0')}`);
  const row = (reg: string, name: string) => ({
    submitted_at: new Date().toISOString(), reg_number: reg, full_name: name, email: '', account_email: '',
    phone: '', department: '', batch: '', preferences: ['', '', '', ''], answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [] },
  });
  const out = await settle(
    () => qmA.api.importCandidates(regs.slice(0, 4).map((r) => row(r, `A ${r}`)) as never),
    () => qmB.api.importCandidates(regs.slice(2).map((r) => row(r, `B ${r}`)) as never),
  );
  const count = sql(`select count(*) from public.candidates where reg_number in (${regs.map((r) => `'${r}'`).join(',')})`);
  record('two desks import overlapping spreadsheets', describe(out), count !== '6' ? `${describe(out)}, ${count} candidates for 6 reg numbers` : undefined);
});

await scenario('results published while a panelist submits', async () => {
  const panel = await newPanel(pans[0]);
  const [c] = await freshCandidates(1);
  const interview = (await qmA.api.sendIn(c, panel))!;
  await pans[0].api.endInterview(interview);
  const out = await settle(() => admin.api.setResultsPublished(true), () => pans[0].api.submitEvaluation(interview, { communication: 3 }, 'maybe', 'race'));
  record('results published while a panelist submits', describe(out));
  await admin.api.setResultsPublished(false);
});

// ---------------------------------------------------------------- chat burst
{
  const name = 'chat burst: 4 panelists x 60 messages at once, plus duplicate retries';
  const panel = await newPanel(...pans);
  const [c] = await freshCandidates(1);
  const interview = (await qmA.api.sendIn(c, panel))!;
  const started = Date.now();
  const sends: Array<() => Promise<unknown>> = [];
  const ids: string[] = [];
  for (let i = 0; i < 60; i++) {
    for (const p of pans) {
      const id = crypto.randomUUID();
      ids.push(id);
      sends.push(() => p.api.postMessage(interview, `msg ${i} from ${p.username} — ✓ اردو`, id));
    }
  }
  // A phone that never saw its answer sends the same message again (same id), 20 times, at once.
  const retryId = crypto.randomUUID();
  for (let i = 0; i < 20; i++) sends.push(() => pans[0].api.postMessage(interview, 'sent twice?', retryId));
  // Like the app: a send that fails is kept and sent again with the same id until it goes through.
  const resend = (call: () => Promise<unknown>) => async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (e) {
        if (attempt >= 5 || !/reach the server/.test((e as Error).message)) throw e;
        retries++;
      }
    }
  };
  let retries = 0;
  const out = await settle(...sends.map(resend));
  const stored = sql(`select count(*) from public.messages where interview_id = '${interview}'`);
  const retried = sql(`select count(*) from public.messages where id = '${retryId}'`);
  const errs = errors(out);
  report[name] = { rounds: 1, problems: [], outcomes: { sent: out.length, ok: oks(out), errors: errs.length, resent: retries, stored: Number(stored), retryCopies: Number(retried), ms: Date.now() - started } };
  if (Number(stored) !== 241) report[name].problems.push(`expected 241 stored messages, got ${stored}`);
  if (retried !== '1') report[name].problems.push(`retried message stored ${retried} times`);
  if (errs.length) report[name].problems.push(...[...new Set(errs)].slice(0, 3));
  const fetched = await pans[1].api.interviewMessages(interview);
  if (fetched.length !== 241) report[name].problems.push(`interview_messages returned ${fetched.length}`);
  console.log(`  ${name}:`, JSON.stringify(report[name].outcomes));
  await qmA.api.endInterview(interview);
}

// ---------------------------------------------------------------- cleanup + report
for (const p of pans) await p.api.setMyPanel(null).catch(() => {});
for (const id of panelsMade) await admin.api.deletePanel(id).catch(() => {});
checkInvariants('cleanup');
console.log('\n================ REPORT');
let failures = 0;
for (const [name, r] of Object.entries(report)) {
  const bad = r.problems.length > 0;
  if (bad) failures++;
  console.log(`${bad ? 'PROBLEM' : 'ok     '} ${name}  ${JSON.stringify(r.outcomes)}`);
  for (const p of r.problems) console.log(`          - ${p}`);
}
console.log(failures ? `\n${failures} scenario(s) with problems` : '\nall scenarios consistent');
