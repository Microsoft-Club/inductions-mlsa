// Connection drops in the middle of real use, in real Chromium against the local stack.
// Three kinds of trouble: offline (the phone knows), dead Wi-Fi (connected but nothing gets through),
// and a lost reply (the server did it, the answer never arrived).
import { expect, test, type Browser, type Page, type WebSocketRoute } from '@playwright/test';
import { createApi, type Api } from '../../src/lib/api.ts';
import { makeAccount, signIn as apiSignIn, uniqueName, TEST_PASSWORD } from '../integration/support.ts';
import { sql } from './db.ts';

const BANNER = 'Reconnecting… The board will catch up as soon as the connection is back.';
const NETWORK = "Can't reach the server. Check the connection and try again.";
let seq = 0;
const RUN = Date.now().toString(36).toUpperCase();

interface Person { username: string; id: string; api: Api }
async function person(role: 'queue_manager' | 'panelist' | 'admin'): Promise<Person> {
  const username = uniqueName(`nc_${role.slice(0, 3)}`);
  const id = await makeAccount(username, role);
  return { username, id, api: createApi(await apiSignIn(username)) };
}

/** A browser window with switches for offline, dead Wi-Fi (no offline event) and back online. */
async function windowFor(browser: Browser, who: Person, path: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let blackhole = false;
  const sockets = new Set<WebSocketRoute>();
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    if (blackhole) return; // never answers: the phone thinks it is still connecting
    const server = ws.connectToServer();
    sockets.add(ws);
    ws.onMessage((m) => { if (!blackhole) server.send(m); });
    server.onMessage((m) => { if (!blackhole) ws.send(m); });
    ws.onClose(() => { sockets.delete(ws); void server.close().catch(() => {}); });
    server.onClose(() => { sockets.delete(ws); void ws.close().catch(() => {}); });
  });
  await context.route((url) => url.port === '54321', (route) => (blackhole ? route.abort('internetdisconnected') : route.fallback()));
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto('/login');
  await page.getByLabel('Username').fill(who.username);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(path);
  const restore = async () => {
    blackhole = false;
    await context.setOffline(false);
    for (const ws of [...sockets]) await ws.close({ code: 4000 }).catch(() => {}); // the dead socket drops; the app reconnects
  };
  return {
    context, page, problems,
    offline: async () => { blackhole = true; await context.setOffline(true); },
    deadWifi: async () => { blackhole = true; },
    online: restore,
  };
}

/** The server does it, but the reply never reaches the page (once). */
async function loseReply(page: Page, rpc: string) {
  await page.route(`**/rest/v1/rpc/${rpc}`, async (route) => {
    await route.fetch(); // reaches the server and is applied
    await route.abort('connectionreset');
  }, { times: 1 });
}

const row = (reg: string, name: string) => ({
  submitted_at: new Date().toISOString(), reg_number: reg, full_name: name, email: '', account_email: '', phone: '', department: '', batch: '',
  preferences: ['', '', '', ''], answers: { general: [{ q: 'Why MLSA?', a: 'To learn.' }], dev: [], logikal: [], lnd: [], marketing: [] },
});
/** Looked up by reg number in the database: the candidate list stops at 1,000 rows, and this database fills up. */
function byReg(reg: string): { id: string; number: number } {
  const [id, number] = sql(`select id, number from public.candidates where reg_number = '${reg}' and induction_id = (select id from public.inductions where is_active)`).split('|');
  return { id, number: Number(number) };
}
async function candidate(desk: Person, checkIn = true) {
  const reg = `NC${RUN}${++seq}`;
  const name = `Net ${RUN} ${seq}`;
  await desk.api.importCandidates([row(reg, name)] as never);
  const c = byReg(reg);
  if (checkIn) await desk.api.checkIn(c.id);
  return { id: c.id, number: c.number, name };
}
const messages = (interviewId: string, body: string) => Number(sql(`select count(*) from public.messages where interview_id = '${interviewId}' and body = '${body.replace(/'/g, "''")}'`));
const interviewStatus = (id: string) => sql(`select status from public.interviews where id = '${id}'`);

let desk: Person;
let admin: Person;
const panels: string[] = [];
test.beforeAll(async () => {
  desk = await person('queue_manager');
  admin = await person('admin');
});
test.afterAll(async () => {
  for (const id of panels) await admin.api.deletePanel(id).catch(() => {});
});
async function panelWith(...seated: Person[]) {
  const id = await admin.api.addPanel();
  panels.push(id);
  for (const p of seated) await p.api.setMyPanel(id);
  return id;
}

// ------------------------------------------------------------------------------------------------
test('an admin who moves between screens still gets live updates on the queue board', async ({ browser }) => {
  const w = await windowFor(browser, admin, '/admin');
  const nav = w.page.getByRole('navigation', { name: 'Screens' });
  await expect(w.page.getByRole('heading', { name: 'Admin' }).first()).toBeVisible();
  await nav.getByRole('link', { name: 'Queue' }).click();
  await expect(w.page.getByRole('list', { name: 'Waiting pool' }).or(w.page.getByText('Nobody is waiting'))).toBeVisible();
  await w.page.waitForTimeout(20_000);
  await expect(w.page.getByText(BANNER), 'no "Reconnecting…" banner 20 s after Admin → Queue').toHaveCount(0);
  const first = await candidate(desk);
  await expect(w.page.getByText(first.name), 'a check-in by the desk appears live').toBeVisible({ timeout: 15_000 });

  // Queue → Panel → Queue, quickly.
  await nav.getByRole('link', { name: 'Panel' }).click();
  await nav.getByRole('link', { name: 'Queue' }).click();
  await w.page.waitForTimeout(20_000);
  await expect(w.page.getByText(BANNER), 'no banner after Queue → Panel → Queue').toHaveCount(0);
  const second = await candidate(desk);
  await expect(w.page.getByText(second.name), 'still live after Queue → Panel → Queue').toBeVisible({ timeout: 15_000 });
  expect(w.problems).toEqual([]);
});

test('chat typed while offline is sent once when the connection is back', async ({ browser }) => {
  const [a, b] = [await person('panelist'), await person('panelist')];
  const panel = await panelWith(a, b);
  const c = await candidate(desk);
  const interview = (await desk.api.sendIn(c.id, panel))!;
  const wa = await windowFor(browser, a, '/panel');
  const wb = await windowFor(browser, b, '/panel');
  const logA = wa.page.getByRole('log', { name: 'Messages' });
  const logB = wb.page.getByRole('log', { name: 'Messages' });
  await expect(wa.page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await expect(wb.page.getByRole('textbox', { name: 'Message' })).toBeVisible();

  await wa.offline();
  await expect(wa.page.getByText(BANNER)).toBeVisible();
  await wa.page.getByRole('textbox', { name: 'Message' }).fill('typed with no signal');
  await wa.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(logA.getByText('Not sent')).toBeVisible();
  await wb.page.getByRole('textbox', { name: 'Message' }).fill('sent while A was offline');
  await wb.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(logB.getByText('sent while A was offline')).toBeVisible();

  await wa.online();
  await expect(wa.page.getByText(BANNER)).toHaveCount(0, { timeout: 30_000 });
  await expect(logB.getByText('typed with no signal'), 'B gets A\'s offline message').toBeVisible({ timeout: 30_000 });
  await expect(logA.getByText('sent while A was offline'), 'A catches up on B\'s message').toBeVisible();
  await expect(logA.getByText('Not sent')).toHaveCount(0);
  expect(messages(interview, 'typed with no signal'), 'stored exactly once').toBe(1);
  await desk.api.endInterview(interview);
});

test('End pressed with no signal fails clearly and works once back', async ({ browser }) => {
  const a = await person('panelist');
  const panel = await panelWith(a);
  const c = await candidate(desk);
  const interview = (await desk.api.sendIn(c.id, panel))!;
  const w = await windowFor(browser, a, '/panel');
  await expect(w.page.getByRole('button', { name: 'End interview' })).toBeVisible();
  await w.offline();
  w.page.on('dialog', (d) => void d.accept());
  await w.page.getByRole('button', { name: 'End interview' }).click();
  await expect(w.page.getByText(NETWORK)).toBeVisible();
  expect(interviewStatus(interview)).toBe('in_progress');
  await w.online();
  await expect(w.page.getByText(BANNER)).toHaveCount(0, { timeout: 30_000 });
  await w.page.getByRole('button', { name: 'End interview' }).click();
  await expect(w.page.getByRole('button', { name: /^Ready in \d+s$/ })).toBeVisible();
  expect(interviewStatus(interview)).toBe('ended');
});

test('End reached the server but the reply was lost: the screen still moves on', async ({ browser }) => {
  const a = await person('panelist');
  const panel = await panelWith(a);
  const c = await candidate(desk);
  const interview = (await desk.api.sendIn(c.id, panel))!;
  const w = await windowFor(browser, a, '/panel');
  await expect(w.page.getByRole('button', { name: 'End interview' })).toBeVisible();
  await loseReply(w.page, 'end_interview');
  w.page.on('dialog', (d) => void d.accept());
  await w.page.getByRole('button', { name: 'End interview' }).click();
  await expect(w.page.getByText(NETWORK)).toBeVisible();
  expect(interviewStatus(interview)).toBe('ended');
  await expect(w.page.getByRole('button', { name: /^Ready in \d+s$|^Ready for next candidate$/ }), 'the Ready bar shows without a reload').toBeVisible();
  await expect(w.page.getByRole('button', { name: 'End interview' })).toHaveCount(0);
});

test('evaluation reached the server but the reply was lost', async ({ browser }) => {
  const a = await person('panelist');
  const panel = await panelWith(a);
  const c = await candidate(desk);
  const interview = (await desk.api.sendIn(c.id, panel))!;
  await desk.api.endInterview(interview);
  const w = await windowFor(browser, a, '/panel');
  const form = w.page.getByRole('region', { name: 'My evaluation' });
  await form.getByRole('group', { name: 'Communication' }).getByRole('radio', { name: '4', exact: true }).check({ force: true });
  await form.getByRole('group', { name: 'Overall recommendation' }).getByRole('radio', { name: 'Yes', exact: true }).check({ force: true });
  await loseReply(w.page, 'submit_evaluation');
  await form.getByRole('button', { name: 'Submit evaluation' }).click();
  await expect(w.page.getByText(NETWORK)).toBeVisible();
  expect(sql(`select count(*) from public.evaluations where interview_id = '${interview}'`)).toBe('1');
  // Something else happens on the board (as it constantly does on the day); the form should catch up.
  await candidate(desk);
  await expect(form.getByRole('button', { name: 'Update evaluation' }), 'the form learns it was saved').toBeVisible({ timeout: 30_000 });
});

test('chat reached the server but the reply was lost: no duplicate, no stuck "Not sent"', async ({ browser }) => {
  const [a, b] = [await person('panelist'), await person('panelist')];
  const panel = await panelWith(a, b);
  const c = await candidate(desk);
  const interview = (await desk.api.sendIn(c.id, panel))!;
  const wa = await windowFor(browser, a, '/panel');
  const logA = wa.page.getByRole('log', { name: 'Messages' });
  await expect(wa.page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await loseReply(wa.page, 'post_message');
  await wa.page.getByRole('textbox', { name: 'Message' }).fill('reply never came back');
  await wa.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(logA.getByText('Not sent')).toBeVisible();
  expect(messages(interview, 'reply never came back')).toBe(1);
  // Someone else writes; A's screen reloads the discussion.
  await b.api.postMessage(interview, 'next message from B', crypto.randomUUID());
  await expect(logA.getByText('next message from B')).toBeVisible();
  const stuck = await logA.getByText('Not sent').count();
  if (stuck) await logA.getByRole('button', { name: 'Retry' }).click();
  await expect(logA.getByText('Not sent')).toHaveCount(0);
  await expect(logA.getByText('reply never came back')).toHaveCount(1);
  expect(messages(interview, 'reply never came back'), 'still one copy after Retry').toBe(1);
  test.info().annotations.push({ type: 'observation', description: stuck ? '"Not sent" stayed until Retry was pressed' : '"Not sent" cleared by itself' });
  await desk.api.endInterview(interview);
});

test('reloading the panel screen on flaky Wi-Fi does not sign the panelist out', async ({ browser }) => {
  const a = await person('panelist');
  await panelWith(a);
  const w = await windowFor(browser, a, '/panel');
  await expect(w.page.getByRole('button', { name: 'Leave panel' })).toBeVisible();
  // The phone reloads the tab while the network is failing for ~10 s.
  await w.page.route('**/rest/v1/**', (route) => route.abort('internetdisconnected'));
  await w.page.reload();
  await w.page.waitForTimeout(10_000);
  const during = new URL(w.page.url()).pathname;
  await w.page.unroute('**/rest/v1/**');
  test.info().annotations.push({ type: 'observation', description: `while failing the page was on ${during}` });
  await expect(w.page.getByRole('button', { name: 'Leave panel' }), 'back on the panel screen without signing in again').toBeVisible({ timeout: 45_000 });
});

test('dead Wi-Fi on the queue desk: the banner shows, and the board catches up afterwards', async ({ browser }) => {
  const w = await windowFor(browser, desk, '/queue');
  await expect(w.page.getByRole('list', { name: 'Waiting pool' }).or(w.page.getByText('Nobody is waiting'))).toBeVisible();
  await w.deadWifi();
  const t0 = Date.now();
  await expect(w.page.getByText(BANNER)).toBeVisible({ timeout: 60_000 });
  const noticed = Date.now() - t0;
  const other = await person('queue_manager');
  const late = await candidate(other); // checked in by another desk meanwhile
  await w.online();
  await expect(w.page.getByText(BANNER)).toHaveCount(0, { timeout: 45_000 });
  await expect(w.page.getByText(late.name), 'the board shows what happened meanwhile').toBeVisible();
  test.info().annotations.push({ type: 'observation', description: `dead Wi-Fi noticed after ${noticed} ms` });
});

test('Ready pressed with no signal fails clearly and works once back', async ({ browser }) => {
  const a = await person('panelist');
  const panel = await panelWith(a);
  const c = await candidate(desk);
  const interview = (await desk.api.sendIn(c.id, panel))!;
  await desk.api.endInterview(interview);
  sql(`update public.interviews set ended_at = clock_timestamp() - interval '30 seconds' where id = '${interview}'`);
  const w = await windowFor(browser, a, '/panel');
  await expect(w.page.getByRole('button', { name: 'Ready for next candidate' })).toBeEnabled();
  await w.offline();
  await w.page.getByRole('button', { name: 'Ready for next candidate' }).click();
  await expect(w.page.getByText(NETWORK)).toBeVisible();
  expect(sql(`select ready_at is null from public.interviews where id = '${interview}'`)).toBe('t');
  await w.online();
  await expect(w.page.getByText(BANNER)).toHaveCount(0, { timeout: 30_000 });
  await w.page.getByRole('button', { name: 'Ready for next candidate' }).click();
  await expect(w.page.getByText("You're ready for the next candidate. The queue desk will send them in.")).toBeVisible();
  const board = await desk.api.boardSnapshot();
  expect(board.panels.find((p) => p.id === panel)?.last_ended?.ready_at).toBeTruthy();
});

test('the next candidate arrives while a panelist is offline; nothing typed is lost', async ({ browser }) => {
  const a = await person('panelist');
  const panel = await panelWith(a);
  const first = await candidate(desk);
  const second = await candidate(desk);
  const i1 = (await desk.api.sendIn(first.id, panel))!;
  const w = await windowFor(browser, a, '/panel');
  const form = w.page.getByRole('region', { name: 'My evaluation' });
  await expect(w.page.getByRole('heading', { name: `#${first.number} ${first.name}` })).toBeVisible();
  await form.getByRole('group', { name: 'Teamwork' }).getByRole('radio', { name: '5', exact: true }).check({ force: true });
  await w.offline();
  await w.page.getByRole('textbox', { name: 'Message' }).fill('note about the first one');
  await w.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(w.page.getByRole('log', { name: 'Messages' }).getByText('Not sent')).toBeVisible();
  await desk.api.endInterview(i1);
  await desk.api.sendIn(second.id, panel);
  await w.online();
  await expect(w.page.getByRole('heading', { name: `#${second.number} ${second.name}` }), 'the new candidate shows by itself').toBeVisible({ timeout: 45_000 });
  await expect.poll(() => messages(i1, 'note about the first one'), { timeout: 45_000, message: 'the stranded note is delivered once' }).toBe(1);
  await w.page.getByRole('tablist', { name: 'Sections', exact: true }).getByRole('tab', { name: /^Recent/ }).click();
  await w.page.getByRole('region', { name: 'Recent' }).getByText(first.name).click();
  await expect(form.getByRole('group', { name: 'Teamwork' }).getByRole('radio', { name: '5', exact: true }), 'the evaluation draft survived').toBeChecked();
  const live = (await desk.api.boardSnapshot()).panels.find((p) => p.id === panel)?.current;
  if (live) await desk.api.endInterview(live.interview_id);
});

test('the projector catches up after a drop', async ({ browser }) => {
  const key = await admin.api.getDisplayKey();
  const a = await person('panelist');
  const panel = await panelWith(a);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto(`/display?key=${encodeURIComponent(key)}`);
  const c = await candidate(desk);
  await desk.api.moveCandidate(c.id, panel, 1); // lined up: the panel's tile shows them as up next
  const tile = page.getByRole('region', { name: (await desk.api.boardSnapshot()).panels.find((p) => p.id === panel)!.name });
  await expect(tile.getByText(c.name)).toBeVisible({ timeout: 35_000 });
  await context.setOffline(true);
  await page.waitForTimeout(5_000);
  const interview = (await desk.api.sendIn(c.id, panel))!;
  await page.waitForTimeout(10_000);
  await context.setOffline(false);
  await expect(tile.getByText('Now interviewing'), 'projector shows the send-in made while it was offline').toBeVisible({ timeout: 45_000 });
  await desk.api.endInterview(interview);
});

test('a long drop past the login token\'s expiry does not sign the panelist out', async ({ browser }) => {
  const a = await person('panelist');
  await panelWith(a);
  const w = await windowFor(browser, a, '/panel');
  await expect(w.page.getByRole('button', { name: 'Leave panel' })).toBeVisible();
  await w.offline();
  // Make the page believe its 10-minute token ran out while it was offline.
  await w.page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const s = JSON.parse(localStorage.getItem(k)!);
      s.expires_at = Math.floor(Date.now() / 1000) - 5;
      localStorage.setItem(k, JSON.stringify(s));
    }
  });
  await w.page.waitForTimeout(45_000); // refresh attempts fail while offline
  await w.online();
  await w.page.waitForTimeout(30_000);
  test.info().annotations.push({ type: 'observation', description: `after reconnecting the page is on ${new URL(w.page.url()).pathname}` });
  await expect(w.page, 'still signed in').toHaveURL(/\/panel$/);
  // supabase-js waits 60 s before retrying a token renewal that failed (here: while offline), so the
  // board can need up to ~75 s after reconnecting (60 s, the next renewal, a channel rejoin) to be live.
  await expect(w.page.getByText(BANNER)).toHaveCount(0, { timeout: 45_000 });
  await expect(w.page.getByRole('button', { name: 'Leave panel' })).toBeVisible();
});
