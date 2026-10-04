// Whole-day simulation for the current app, local stack only. A fresh induction; 3 panels x 4 panelists,
// a queue desk and 45 candidates through check-in, send-in, chat, End, evaluations, Ready and the next one.
// Simulated people use the app's own API layer and realtime code, with random connection drops; three
// real Chromium windows (desk, a panelist's phone, the projector) watch for crashes and must converge.
// Run: npm run stress:day   (needs db:start, web:env and `npm run dev` running; env: SIM_CANDIDATES, SIM_MIN_S, SIM_MAX_S, SIM_CAP_MIN)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chromium, devices } from '@playwright/test';
import { createApi, type Api } from '../../src/lib/api.ts';
import type { BoardSnapshot, BoardPanel, DisplaySnapshot } from '../../src/lib/types.ts';
import { makeAccount, uniqueName, env, TEST_PASSWORD } from '../integration/support.ts';
import { sql } from './db.ts';
import { usernameToEmail } from '../../supabase/functions/_shared/accounts.ts';

if (!/127\.0\.0\.1|localhost/.test(env.url)) throw new Error('local stack only');
const WEB = 'http://localhost:5173';
if (!(await fetch(WEB).then((r) => r.ok, () => false))) throw new Error(`The dev server isn't running at ${WEB}: start it with \`npm run dev\` in another terminal.`);
const N = Number(process.env.SIM_CANDIDATES ?? 45);
const MIN_S = Number(process.env.SIM_MIN_S ?? 15);
const MAX_S = Number(process.env.SIM_MAX_S ?? 30);
const CAP_MS = Number(process.env.SIM_CAP_MIN ?? 25) * 60_000;
const SEATS = 4;
const RUN = Date.now().toString(36).toUpperCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

// ---------------------------------------------------------------- metrics
const calls = new Map<string, { ok: number; ms: number[]; errors: Map<string, number> }>();
function recordCall(name: string, ms: number, error?: string) {
  const m = calls.get(name) ?? { ok: 0, ms: [], errors: new Map() };
  calls.set(name, m);
  if (error) m.errors.set(error, (m.errors.get(error) ?? 0) + 1);
  else { m.ok++; m.ms.push(ms); }
}
const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0);
const fresh = { panelSeesSendIn: [] as number[], deskSeesEnd: [] as number[] };
const wsSystemErrors: string[] = [];
let wsAbnormalCloses = 0;

// ---------------------------------------------------------------- simulated people with switchable networks
interface Net { down: boolean; sockets: Set<WebSocket>; fetch: typeof fetch; WebSocket: typeof WebSocket; drops: number }
function makeNet(label: string): Net {
  const net = { down: false, sockets: new Set(), drops: 0 } as unknown as Net;
  net.fetch = async (input, init) => {
    if (net.down) { await sleep(rand(50, 300)); throw new TypeError('fetch failed'); }
    return fetch(input, init);
  };
  class NetWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      net.sockets.add(this);
      this.addEventListener('close', (e) => {
        net.sockets.delete(this);
        if (e.code !== 1000 && e.code !== 1005 && e.reason !== 'simulated drop') wsAbnormalCloses++;
      });
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) { if (!net.down) super.send(data); }
    set onmessage(fn: ((ev: MessageEvent) => void) | null) {
      super.onmessage = fn && ((ev: MessageEvent) => {
        if (net.down) return;
        const text = typeof ev.data === 'string' ? ev.data : '';
        if (/"phx_error"|too_many|"status":"error"/.test(text)) wsSystemErrors.push(`${label}: ${text.slice(0, 200)}`);
        fn(ev);
      });
    }
    get onmessage() { return super.onmessage; }
  }
  net.WebSocket = NetWebSocket as unknown as typeof WebSocket;
  return net;
}
function timed(api: Api): Api {
  return new Proxy(api, {
    get(target, prop) {
      const value = (target as never)[prop] as unknown;
      if (typeof value !== 'function' || String(prop).startsWith('subscribe')) return value;
      return async (...args: unknown[]) => {
        const start = performance.now();
        try {
          const r = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          recordCall(String(prop), performance.now() - start);
          return r;
        } catch (e) {
          recordCall(String(prop), performance.now() - start, (e as Error).message);
          throw e;
        }
      };
    },
  });
}
interface Person { label: string; username: string; id: string; net: Net; client: SupabaseClient; api: Api }
async function person(label: string, role: 'queue_manager' | 'panelist' | 'admin'): Promise<Person> {
  const username = uniqueName(`ds_${role.slice(0, 3)}`);
  const id = await makeAccount(username, role);
  const net = makeNet(label);
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
    global: { fetch: net.fetch },
    realtime: { transport: net.WebSocket as never, heartbeatIntervalMs: 10_000 },
  });
  const { error } = await client.auth.signInWithPassword({ email: usernameToEmail(username), password: TEST_PASSWORD });
  if (error) throw error;
  return { label, username, id, net, client, api: timed(createApi(client)) };
}
/** Like a person pressing again after "Can't reach the server": retries network failures only. */
async function persist<T>(fn: () => Promise<T>, tries = 20): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      const msg = (e as Error).message;
      if (i >= tries || !/reach the server|took too long/i.test(msg)) throw e;
      await sleep(2000);
    }
  }
}

type Subscribe = (h: { onEvent: () => void; onStatus: (s: string) => void }) => () => void;
/** The screens' useLiveSnapshot loop without React (load, reload on events and on (re)subscribe, never overlapping). */
function live<T>(load: () => Promise<T>, subscribe: unknown, onData: (d: T) => void, pollMs?: number) {
  const st = { running: false, again: false, data: undefined as T | undefined, stopped: false };
  const reload = () => {
    if (st.stopped) return;
    if (st.running) { st.again = true; return; }
    st.running = true;
    void (async () => {
      try {
        do {
          st.again = false;
          try { const d = await load(); if (!st.stopped) { st.data = d; onData(d); } } catch { /* the banner would show */ }
        } while (st.again && !st.stopped);
      } finally { st.running = false; }
    })();
  };
  reload();
  const stop = (subscribe as Subscribe)({ onEvent: reload, onStatus: (s) => { if (s === 'subscribed') reload(); } });
  const timer = pollMs ? setInterval(reload, pollMs) : undefined;
  return { st, reload, stop: () => { st.stopped = true; clearInterval(timer); stop(); } };
}
const state = (p: BoardPanel) => (p.current ? 'busy' : p.last_ended && p.last_ended.ready_at === null ? 'wrapping_up' : 'ready');
const digest = (b?: BoardSnapshot) => b && JSON.stringify({ panels: b.panels.map((p) => [p.id, p.current?.interview_id ?? null, p.last_ended?.ready_at ? 'r' : '-', p.lane.map((e) => e.candidate_id)]), pool: b.pool.map((e) => e.candidate_id), counts: b.counts });

// ---------------------------------------------------------------- setup: a fresh induction, as tomorrow's checklist does
const oldInduction = sql(`select id from public.inductions where is_active`);
const oldSeats = sql(`select coalesce(string_agg(id || '=' || current_panel_id, ','), '') from public.profiles where current_panel_id is not null`);
sql(`begin; select public.create_induction('Day sim ${RUN}'); update public.profiles set current_panel_id = null; commit;`);
const inductionId = sql(`select id from public.inductions where is_active`);
log(`fresh induction ${inductionId} (was ${oldInduction})`);
let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  sql(`begin; update public.inductions set is_active = false where is_active; update public.inductions set is_active = true where id = '${oldInduction}'; update public.profiles set current_panel_id = null;${oldSeats ? oldSeats.split(',').map((kv) => { const [id, p] = kv.split('='); return ` update public.profiles set current_panel_id = '${p}' where id = '${id}';`; }).join('') : ''} commit;`);
  log(`restored induction ${oldInduction}`);
}
process.on('exit', restore);

const desk = await person('desk', 'queue_manager');
const admin = await person('admin', 'admin');
await admin.api.addPanel();
const panels = (await admin.api.boardSnapshot()).panels.map((p) => ({ id: p.id, name: p.name }));
const panelists: Array<Person & { panel: string; seat: number }> = [];
for (const [pi, p] of panels.entries()) for (let s = 0; s < SEATS; s++) {
  const who = await person(`p${pi + 1}.${s + 1}`, 'panelist');
  await who.api.setMyPanel(p.id);
  panelists.push({ ...who, panel: p.id, seat: s });
}
const FIRST = ['Ayesha', 'Hamza', 'Zainab', 'Ali', 'Fatima', 'Usman', 'Maryam', 'Bilal', 'Hira', 'Saad', 'Iqra', 'Talha', 'عائشہ', "Zara O'Brien"];
const LAST = ['Khan', 'Raza', 'Ahmed', 'Malik', 'Siddiqui', 'Qureshi', 'Butt', 'Abbasi', 'خان'];
await desk.api.importCandidates(Array.from({ length: N }, (_, i) => ({
  submitted_at: new Date(Date.now() - (N - i) * 60_000).toISOString(), reg_number: `DS${RUN}${String(i + 1).padStart(3, '0')}`,
  full_name: `${pick(FIRST)} ${pick(LAST)} ${i + 1}`, email: `ds${i}@example.test`, account_email: '', phone: '0300000000', department: 'CS', batch: 'B35',
  preferences: ['Dev Team', 'Marketing', '', ''],
  answers: { general: [{ q: 'Why MLSA?', a: 'Lorem ipsum '.repeat(40) }], dev: [{ q: 'Project?', a: 'A website.' }], logikal: [], lnd: [], marketing: [] },
})) as never);
const roster = (await desk.api.listCandidates(inductionId)).sort((a, b) => a.number - b.number);
const criteria = (await admin.api.criteria(inductionId)).map((c) => c.key);
const displayKey = await admin.api.getDisplayKey();
log(`${panels.length} panels x ${SEATS} panelists, ${roster.length} candidates, ${criteria.length} criteria`);

// ---------------------------------------------------------------- bookkeeping shared by the bots
const sentInAt = new Map<string, number>(); // interviewId -> ms
const endedAt = new Map<string, number>();
const intendedMessages = new Map<string, string>(); // message id -> interview id
const unexpected: string[] = [];
const EXPECTED = /reach the server|took too long|is busy|is not waiting|not in progress|no longer .*latest interview|Ready unlocks|already waiting/i;
function note(where: string, e: unknown) {
  const msg = (e as Error).message;
  if (!EXPECTED.test(msg) && unexpected.length < 40) unexpected.push(`${where}: ${msg}`);
}

// ---------------------------------------------------------------- panelists
const lives: Array<{ label: string; stop: () => void; st: { data?: unknown } }> = [];
for (const me of panelists) {
  const handled = new Set<string>();
  const wrapped = new Set<string>();
  const l = live<BoardSnapshot>(() => me.api.boardSnapshot(), me.api.subscribeBoard(), (b) => {
    const mine = b.panels.find((p) => p.id === me.panel);
    if (!mine) return;
    const cur = mine.current;
    if (cur && !handled.has(cur.interview_id)) {
      handled.add(cur.interview_id);
      const sent = sentInAt.get(cur.interview_id);
      if (sent) fresh.panelSeesSendIn.push(Date.now() - sent);
      const length = rand(MIN_S, MAX_S) * 1000;
      const notes = Math.floor(rand(0, 4));
      for (let i = 0; i < notes; i++) {
        setTimeout(() => {
          const id = crypto.randomUUID();
          intendedMessages.set(id, cur.interview_id);
          void persist(() => me.api.postMessage(cur.interview_id, `${me.label}: note ${i + 1} on #${cur.number} — ✓`, id)).catch((e) => note('postMessage', e));
        }, rand(1000, length));
      }
      // The first seat ends it; now and then a second panelist presses End at the same moment.
      if (me.seat === 0) {
        setTimeout(() => {
          void persist(() => me.api.endInterview(cur.interview_id)).then(() => endedAt.set(cur.interview_id, Date.now()), (e) => note('endInterview', e));
          if (Math.random() < 0.15) void panelists.find((p) => p.panel === me.panel && p.seat === 1)!.api.endInterview(cur.interview_id).catch((e) => note('endInterview(2nd)', e));
        }, length);
      }
    }
    const last = mine.last_ended;
    if (last && !cur && !wrapped.has(last.interview_id)) {
      wrapped.add(last.interview_id);
      // Everyone evaluates (pressing again if the network fails); the first seat presses Ready after the countdown.
      setTimeout(() => {
        const scores = Object.fromEntries(criteria.filter(() => Math.random() < 0.7).map((k) => [k, 1 + Math.floor(Math.random() * 5)]));
        void persist(() => me.api.submitEvaluation(last.interview_id, scores, pick(['strong_yes', 'yes', 'maybe', 'no'] as const), Math.random() < 0.3 ? 'Good energy' : '')).catch((e) => note('submitEvaluation', e));
      }, rand(2000, 12_000));
      if (me.seat === 0 && last.ready_at === null) {
        setTimeout(() => void persist(() => me.api.markPanelReady(last.interview_id)).catch((e) => note('markPanelReady', e)), rand(15_500, 22_000));
      }
    }
  });
  lives.push({ label: me.label, stop: l.stop, st: l.st });
}

// ---------------------------------------------------------------- the queue desk
let deskBoard: BoardSnapshot | undefined;
const deskSeen = new Set<string>();
const deskLive = live<BoardSnapshot>(() => desk.api.boardSnapshot(), desk.api.subscribeBoard(), (b) => {
  deskBoard = b;
  for (const p of b.panels) {
    const id = p.last_ended?.interview_id;
    if (id && !p.current && !deskSeen.has(id) && endedAt.has(id)) { deskSeen.add(id); fresh.deskSeesEnd.push(Date.now() - endedAt.get(id)!); }
  }
});
lives.push({ label: 'desk', stop: deskLive.stop, st: deskLive.st });

// The projector's data loop (no login), as the display page runs it.
const projNet = makeNet('projector');
const projClient = createClient(env.url, env.anonKey, { auth: { persistSession: false }, global: { fetch: projNet.fetch }, realtime: { transport: projNet.WebSocket as never } });
const projApi = createApi(projClient);
let projData: DisplaySnapshot | null | undefined;
const projLive = live<DisplaySnapshot | null>(() => projApi.displaySnapshot(displayKey), projApi.subscribeDisplay(displayKey), (d) => (projData = d), 30_000);

// ---------------------------------------------------------------- real browser windows
const browser = await chromium.launch();
const pageProblems: string[] = [];
async function window(username: string | null, path: string, opts: Parameters<typeof browser.newContext>[0] = { viewport: { width: 1440, height: 900 } }) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  page.on('pageerror', (e) => pageProblems.push(`${path} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|WebSocket/.test(m.text())) pageProblems.push(`${path} console: ${m.text().slice(0, 160)}`); });
  if (username) {
    await page.goto(`${WEB}/login`);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  await page.goto(`${WEB}${path}`);
  return { context, page };
}
const deskWatcher = await person('desk-window', 'queue_manager');
const deskWin = await window(deskWatcher.username, '/queue');
const phoneWin = await window(panelists[1].username, '/panel', { ...devices['Pixel 7'] });
const projWin = await window(null, `/display?key=${encodeURIComponent(displayKey)}`, { viewport: { width: 1920, height: 1080 } });

// ---------------------------------------------------------------- chaos: connections drop
let chaos = true;
const everyone = () => [...panelists, desk, admin];
const chaosLoop = (async () => {
  await sleep(20_000);
  while (chaos) {
    const victim = pick<Person>([...panelists, desk, desk, admin]);
    const ms = rand(5_000, 20_000);
    victim.net.down = true;
    victim.net.drops++;
    for (const s of victim.net.sockets) try { s.close(4000, 'simulated drop'); } catch { /* */ }
    setTimeout(() => (victim.net.down = false), ms);
    if (Math.random() < 0.25) {
      const w = pick([deskWin, phoneWin, projWin]);
      void w.context.setOffline(true).then(() => sleep(rand(5_000, 15_000))).then(() => w.context.setOffline(false));
    }
    await sleep(rand(15_000, 35_000));
  }
})();

// ---------------------------------------------------------------- the desk's day
const rosterIds = new Set(roster.map((c) => c.id));
const wrappingSince = new Map<string, number>();
const inFlight = new Set<string>();
let arrivals = 0;
let lastLog = 0;
log('doors open');
while (Date.now() - t0 < CAP_MS) {
  await sleep(1000);
  const due = Math.min(N, 12 + Math.floor((Date.now() - t0) / 4000)); // a dozen at the start, then one every few seconds
  while (arrivals < due) {
    const c = roster[arrivals++];
    void persist(() => desk.api.checkIn(c.id)).catch((e) => note('checkIn', e));
  }
  const b = deskBoard;
  if (!b) continue;
  if (b.counts.interviewed >= N && b.panels.every((p) => !p.current)) break;
  for (const p of b.panels) {
    const st = state(p);
    if (st === 'wrapping_up') wrappingSince.set(p.id, wrappingSince.get(p.id) ?? Date.now());
    else wrappingSince.delete(p.id);
    const forgotReady = st === 'wrapping_up' && Date.now() - (wrappingSince.get(p.id) ?? Date.now()) > 45_000; // "send in anyway"
    if ((st !== 'ready' && !forgotReady) || inFlight.has(p.id) || p.panelists.length === 0) continue;
    const next = p.lane[0]?.candidate_id ?? b.pool.find((e) => rosterIds.has(e.candidate_id))?.candidate_id;
    if (!next) continue;
    inFlight.add(p.id);
    const pressed = Date.now();
    void desk.api.sendIn(next, p.id).then((iv) => { if (iv) sentInAt.set(iv, pressed); }, (e) => note('sendIn', e)).finally(() => setTimeout(() => inFlight.delete(p.id), 1500));
  }
  if (Math.random() < 0.08 && b.pool.length > 2) void desk.api.moveCandidate(b.pool[1].candidate_id, pick(panels).id, null).catch((e) => note('moveCandidate', e));
  if (Math.random() < 0.03 && b.pool.length > 1) void desk.api.skipCandidate(b.pool[0].candidate_id).catch((e) => note('skipCandidate', e));
  if (Date.now() - lastLog > 60_000) {
    lastLog = Date.now();
    log(`interviewed ${b.counts.interviewed}/${N}, waiting ${b.counts.waiting}, drops so far ${everyone().reduce((a, p) => a + p.net.drops, 0)}`);
  }
}
chaos = false;
await chaosLoop;
for (const p of everyone()) p.net.down = false;
for (const w of [deskWin, phoneWin, projWin]) await w.context.setOffline(false);
log('day over; letting everything settle');
await sleep(25_000); // last evaluations and Ready presses, reconnects

// ---------------------------------------------------------------- checks
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
const server = await admin.api.boardSnapshot();
check('every candidate interviewed', server.counts.interviewed === N, `${server.counts.interviewed}/${N}; counts ${JSON.stringify(server.counts)}`);
const evalGaps = sql(`select c.number || ':' || count(e.*) from public.interviews i join public.candidates c on c.id = i.candidate_id left join public.evaluations e on e.interview_id = i.id where i.induction_id = '${inductionId}' and i.status = 'ended' group by c.number having count(e.*) <> ${SEATS}`);
check(`every interview has ${SEATS} evaluations`, !evalGaps, evalGaps.replace(/\n/g, ' '));
const ids = [...intendedMessages.keys()];
const stored = ids.length ? Number(sql(`select count(*) from public.messages where id in (${ids.map((i) => `'${i}'`).join(',')})`)) : 0;
check('every chat message stored exactly once', stored === ids.length, `${stored}/${ids.length}`);
const notReady = sql(`select count(*) from public.panels p where p.induction_id = '${inductionId}' and p.deleted_at is null and exists (select 1 from public.interviews i where i.id = public.panel_reopenable_interview(p.id) and i.ready_at is null)`);
check('every panel ended the day Ready', notReady === '0', `${notReady} still wrapping up`);
const cancelled = sql(`select count(*) from public.interviews where induction_id = '${inductionId}' and status = 'cancelled'`);
check('no interview cancelled', cancelled === '0', cancelled);
for (const l of lives) check(`${l.label}'s live board matches the server`, digest(l.st.data as BoardSnapshot) === digest(server));
const projFresh = await projApi.displaySnapshot(displayKey);
const strip = (d: DisplaySnapshot | null | undefined) => d && JSON.stringify({ ...d, server_time: null });
check('projector data matches the server', strip(projData) === strip(projFresh));
await deskWin.page.waitForTimeout(3000);
const deskCounts = (await deskWin.page.getByLabel('Candidate counts').textContent()) ?? '';
check('desk window shows the final count', deskCounts.includes(`Interviewed ${N}`), deskCounts);
const banners = await Promise.all([deskWin, phoneWin].map((w) => w.page.getByText('Reconnecting…').count()));
check('no window stuck on "Reconnecting…"', banners.every((n) => n === 0), banners.join(','));
check('no crashes or console errors in the windows', pageProblems.length === 0, pageProblems.slice(0, 6).join(' | '));
check('no unexpected server errors', unexpected.length === 0, unexpected.slice(0, 8).join(' | '));
check('no realtime system errors', wsSystemErrors.length === 0, wsSystemErrors.slice(0, 3).join(' | '));
const broken = [
  ['two in-progress per panel', `select 1 from public.interviews where status = 'in_progress' group by panel_id having count(*) > 1`],
  ['lane positions', `select 1 from public.queue_entries group by induction_id, panel_id having min(position) <> 1 or max(position) <> count(*) or count(distinct position) <> count(*)`],
  ['status vs interviews', `select 1 from public.candidates c where induction_id = '${inductionId}' and ((c.status = 'interviewing') <> exists (select 1 from public.interviews i where i.candidate_id = c.id and i.status = 'in_progress'))`],
].filter(([, q]) => sql(q)).map(([n]) => n);
check('database invariants', broken.length === 0, broken.join(', '));

// ---------------------------------------------------------------- report, then put things back
console.log('\n================ DAY SIM REPORT');
for (const c of checks) console.log(`${c.ok ? 'ok    ' : 'FAILED'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
console.log(`\nduration ${((Date.now() - t0) / 60_000).toFixed(1)} min; connection drops ${everyone().reduce((a, p) => a + p.net.drops, 0)}; abnormal socket closes ${wsAbnormalCloses}; messages ${ids.length}`);
console.log(`freshness ms: panel sees send-in p50 ${pct(fresh.panelSeesSendIn, 50)} p95 ${pct(fresh.panelSeesSendIn, 95)} max ${pct(fresh.panelSeesSendIn, 100)}; desk sees End p50 ${pct(fresh.deskSeesEnd, 50)} p95 ${pct(fresh.deskSeesEnd, 95)} max ${pct(fresh.deskSeesEnd, 100)}`);
console.log('calls (ok / p50 / p95 / max ms; errors):');
for (const [name, m] of [...calls.entries()].sort()) {
  console.log(`  ${name.padEnd(18)} ${String(m.ok).padStart(5)} / ${pct(m.ms, 50).toFixed(0)} / ${pct(m.ms, 95).toFixed(0)} / ${pct(m.ms, 100).toFixed(0)}  ${m.errors.size ? JSON.stringify(Object.fromEntries(m.errors)) : ''}`);
}
for (const l of lives) l.stop();
projLive.stop();
await browser.close();
restore();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
