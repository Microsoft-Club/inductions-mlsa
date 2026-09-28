// What only a real browser shows about the panel discussion: a message that failed to send, and text
// being typed, survive the next candidate being sent in; and the list keeps its newest message in
// view, on a phone's Chat tab and on a desktop. Uses two fresh candidates and a panel of its own.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localEnv } from '../../scripts/lib/local-env.ts';
import { usernameToEmail } from '../../supabase/functions/_shared/accounts.ts';
import { createApi, type Api } from '../../src/lib/api.ts';

const PASSWORD = 'induction-dev';
const stamp = String(Date.now()).slice(-6);
let panelId: string | undefined;

async function apiAs(username: string): Promise<Api> {
  const env = localEnv();
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: usernameToEmail(username), password: PASSWORD });
  if (error) throw error;
  return createApi(client);
}

async function openPanel(browser: Browser, panelName: string, viewport: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto('/panel');
  await page.getByLabel('Username').fill('panelist1');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const chooser = page.getByRole('heading', { name: 'Which panel are you sitting in?' });
  const select = page.getByRole('combobox', { name: 'Your panel' });
  await expect(chooser.or(select)).toBeVisible();
  if (await chooser.isVisible()) await page.getByRole('button', { name: panelName, exact: true }).click();
  else if ((await select.inputValue()) !== panelId) await select.selectOption({ label: panelName });
  await expect(page.getByRole('heading', { level: 1, name: panelName })).toBeVisible();
  return page;
}

test('the discussion keeps unsent messages and its newest message in view', async ({ browser }) => {
  const qm = await apiAs('queue');
  const other = await apiAs('panelist2');
  const names = [`Chat Test A ${stamp}`, `Chat Test B ${stamp}`];
  const empty = { general: [], dev: [], logikal: [], lnd: [], marketing: [] };
  await qm.importCandidates(
    names.map((full_name, i) => ({
      submitted_at: new Date().toISOString(), reg_number: `CH${i}${stamp}`, full_name, email: '', account_email: '',
      phone: '', department: 'Test', batch: 'B00', preferences: [], answers: empty,
    })),
  );
  panelId = await qm.addPanel();
  const board = await qm.boardSnapshot();
  const panelName = board.panels.find((p) => p.id === panelId)!.name;
  const people = (await qm.listCandidates(board.induction.id)).filter((c) => names.includes(c.full_name));
  const [a, b] = names.map((n) => people.find((c) => c.full_name === n)!);
  await qm.checkIn(a.id);
  await qm.checkIn(b.id);
  // The panelist sits in the panel first: send in lines people up for a panel nobody is sitting in.
  const desk = await openPanel(browser, panelName, { width: 1440, height: 900 });
  const first = (await qm.sendIn(a.id, panelId))!;

  // The Wi-Fi drops while sending; the panelist keeps typing; the next candidate is sent in.
  await expect(desk.getByRole('heading', { name: `#${a.number} ${a.full_name}` })).toBeVisible();
  await desk.route('**/rest/v1/rpc/post_message', (route) => route.abort());
  const box = desk.getByRole('textbox', { name: 'Message' });
  await box.fill('Ask about Docker');
  await box.press('Enter');
  await expect(desk.getByText('Not sent')).toBeVisible();
  await box.fill('Half typed');
  await qm.endInterview(first);
  const second = (await qm.sendIn(b.id, panelId))!;
  await expect(desk.getByRole('heading', { name: `#${b.number} ${b.full_name}` })).toBeVisible();
  await expect(box).toHaveValue('');

  // Back on the first candidate, both are still there, and Retry delivers the message.
  await desk.getByRole('tablist', { name: 'Sections', exact: true }).getByRole('tab', { name: /^Recent/ }).click();
  await desk.getByRole('region', { name: 'Recent' }).getByRole('button', { name: `#${a.number} ${a.full_name}` }).click();
  await expect(desk.getByRole('log', { name: 'Messages' })).toContainText('Ask about Docker');
  await expect(box).toHaveValue('Half typed');
  await desk.unroute('**/rest/v1/rpc/post_message');
  await desk.getByRole('button', { name: 'Retry' }).click();
  await expect(desk.getByText('Not sent')).toHaveCount(0);
  await desk.getByRole('button', { name: 'Back to the current interview' }).click();
  await expect(desk.getByRole('heading', { name: `#${b.number} ${b.full_name}` })).toBeVisible();

  // A long discussion: on a phone the Chat tab opens at the newest message ...
  for (let i = 1; i <= 25; i++) await other.postMessage(second, `Note ${i}: long enough that the list has to scroll.`, crypto.randomUUID());
  const phone = await openPanel(browser, panelName, { width: 390, height: 844 });
  await expect(phone.getByRole('heading', { name: `#${b.number} ${b.full_name}` })).toBeVisible();
  await phone.getByRole('tab', { name: 'Chat' }).click();
  await expect(phone.getByRole('log', { name: 'Messages' }).getByText('Note 25:')).toBeInViewport();

  // ... and on a desktop a new message scrolls into view.
  await other.postMessage(second, 'Newest on desktop', crypto.randomUUID());
  await expect(desk.getByRole('log', { name: 'Messages' }).getByText('Newest on desktop')).toBeInViewport();
});

// Put the shared dev database back: out of the panel, interview ended, panel deleted.
test.afterAll(async () => {
  const [qm, first] = await Promise.all([apiAs('queue'), apiAs('panelist1')]);
  await first.setMyPanel(null).catch(() => undefined);
  const panel = (await qm.boardSnapshot()).panels.find((p) => p.id === panelId);
  if (panel?.current) await qm.endInterview(panel.current.interview_id).catch(() => undefined);
  if (panel) await qm.deletePanel(panel.id).catch(() => undefined);
});
