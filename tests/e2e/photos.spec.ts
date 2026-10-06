// Candidate photos in real browsers: the photographer's list and camera, the queue manager's
// "no photo yet" question (take one on the spot, or send without), the photo on the panelist's card,
// and an admin deleting them all. Uses the dev accounts from `npm run seed:dev`.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localEnv } from '../../scripts/lib/local-env.ts';
import { usernameToEmail } from '../../supabase/functions/_shared/accounts.ts';
import { createApi, type Api } from '../../src/lib/api.ts';

const PASSWORD = 'induction-dev';
const stamp = String(Date.now()).slice(-6);
const people = ['Photo Ready', 'Photo Later', 'Photo Never'].map((name, i) => ({ name: `${name} ${stamp}`, reg: `PH${i}${stamp}` }));
let panelId: string | undefined;

async function apiAs(username: string): Promise<Api> {
  const env = localEnv();
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: usernameToEmail(username), password: PASSWORD });
  if (error) throw error;
  return createApi(client);
}

async function signIn(browser: Browser, username: string, path: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  return page;
}

async function joinPanel(page: Page, name: string): Promise<void> {
  const chooser = page.getByRole('heading', { name: 'Which panel are you sitting in?' });
  const seated = page.getByRole('button', { name: 'Leave panel' });
  await expect(chooser.or(seated)).toBeVisible();
  if (await chooser.isVisible()) await page.getByRole('button', { name, exact: true }).click();
  else if (!(await page.getByRole('heading', { level: 1, name }).isVisible())) {
    await page.getByRole('button', { name: 'Switch panel' }).click();
    await page.getByRole('group', { name: 'Switch to' }).getByRole('button', { name, exact: true }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** A 1600×1200 JPEG drawn in the page: twice the 800 px the app keeps. */
async function bigJpeg(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#2563eb';
    context.fillRect(0, 0, 1600, 1200);
    context.fillStyle = '#f59e0b';
    context.fillRect(400, 300, 800, 600);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

async function endCurrentInterview(qmApi: Api): Promise<void> {
  const panel = (await qmApi.boardSnapshot()).panels.find((p) => p.id === panelId);
  if (panel?.current) await qmApi.endInterview(panel.current.interview_id);
}

test('photos from check-in to the panel, and deleting them all', async ({ browser }) => {
  // Setup through the API: a panel of our own and three checked-in candidates.
  const qmApi = await apiAs('queue');
  panelId = await (await apiAs('admin')).addPanel(); // only admins add panels
  const board = await qmApi.boardSnapshot();
  const panelName = board.panels.find((p) => p.id === panelId)!.name;
  await qmApi.importCandidates(people.map((p) => ({
    submitted_at: new Date().toISOString(), reg_number: p.reg, full_name: p.name, email: '', account_email: '',
    phone: '', department: '', batch: '', preferences: ['', '', '', ''],
    answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [] },
  })));
  const everyone = await qmApi.listCandidates(board.induction.id);
  const [ready, later, never] = people.map((p) => everyone.find((c) => c.reg_number === p.reg)!);
  for (const candidate of [ready, later, never]) await qmApi.checkIn(candidate.id);

  // The photographer photographs the first one; the photo is kept at 800 px.
  const photographer = await signIn(browser, 'photos', '/photos');
  const needs = photographer.getByRole('list', { name: 'Needs photo' });
  await needs.getByRole('button', { name: `#${ready.number} ${ready.full_name}` }).click();
  const capture = photographer.getByRole('dialog', { name: `Photo of #${ready.number} ${ready.full_name}` });
  await capture.getByLabel('Photo file').setInputFiles({ name: 'ready.jpg', mimeType: 'image/jpeg', buffer: await bigJpeg(photographer) });
  await expect(capture.getByRole('img', { name: `New photo of ${ready.full_name}` })).toBeVisible();
  await capture.getByRole('button', { name: 'Save' }).click();
  await expect(capture).toBeHidden();
  const thumbnail = photographer.getByRole('list', { name: 'Done' }).getByRole('img', { name: `Photo of ${ready.full_name}` });
  await expect(thumbnail).toBeVisible();
  expect(await thumbnail.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([800, 600]);
  await expect(needs.getByRole('button', { name: `#${later.number} ${later.full_name}` })).toBeVisible();

  // The queue manager sees who has no photo.
  const qm = await signIn(browser, 'queue', '/queue');
  const pool = qm.getByRole('list', { name: 'Waiting pool' });
  const row = (candidate: { full_name: string }) => pool.getByRole('listitem').filter({ hasText: candidate.full_name });
  await expect(row(later).getByRole('button', { name: `Take a photo of #${later.number}` })).toBeVisible();
  await expect(row(ready).getByRole('button', { name: `Take a photo of #${ready.number}` })).toHaveCount(0);

  // A panelist sits in the panel first: send in lines people up for a panel nobody is sitting in.
  const panelist = await signIn(browser, 'panelist3', '/panel');
  await joinPanel(panelist, panelName);

  // No photo yet: take it on the spot, and the send-in carries on.
  const panelCard = qm.getByRole('region', { name: panelName });
  await row(later).getByRole('button', { name: `Send in → ${panelName}` }).click();
  const question = qm.getByRole('alertdialog', { name: 'No photo yet' });
  await expect(question).toContainText(`#${later.number} ${later.full_name} has no photo yet.`);
  await question.getByRole('button', { name: 'Take photo' }).click();
  const qmCapture = qm.getByRole('dialog', { name: `Photo of #${later.number} ${later.full_name}` });
  await qmCapture.getByLabel('Photo file').setInputFiles({ name: 'later.jpg', mimeType: 'image/jpeg', buffer: await bigJpeg(qm) });
  await qmCapture.getByRole('button', { name: 'Save' }).click();
  await expect(panelCard.getByText('Now interviewing')).toBeVisible();
  await expect(panelCard).toContainText(later.full_name);
  // The photographer's page is still open; its list updates live from the board signal, no reload.
  await expect(photographer.getByText(later.full_name)).toHaveCount(0);
  await endCurrentInterview(qmApi);

  // With a photo: straight in, and the panelist sees the face on the card. Nobody pressed Ready after
  // the last interview, so the desk is asked first and sends in anyway.
  const sendInAnyway = (number: number) =>
    qm.once('dialog', (dialog) => {
      expect(dialog.message()).toBe(`${panelName} hasn't said they're ready yet. Send #${number} in anyway?`);
      void dialog.accept();
    });
  sendInAnyway(ready.number);
  await row(ready).getByRole('button', { name: `Send in → ${panelName}` }).click();
  await expect(panelCard).toContainText(ready.full_name);
  await expect(qm.getByRole('alertdialog', { name: 'No photo yet' })).toHaveCount(0);
  await expect(panelist.getByRole('heading', { name: `#${ready.number} ${ready.full_name}` })).toBeVisible();
  await expect(panelist.getByRole('img', { name: `Photo of ${ready.full_name}` }).first()).toBeVisible();
  await endCurrentInterview(qmApi);

  // Without a photo, sent anyway: the panelist sees the placeholder.
  sendInAnyway(never.number);
  await row(never).getByRole('button', { name: `Send in → ${panelName}` }).click();
  await qm.getByRole('alertdialog', { name: 'No photo yet' }).getByRole('button', { name: 'Send without photo' }).click();
  await expect(panelCard).toContainText(never.full_name);
  await expect(panelist.getByRole('img', { name: `No photo of ${never.full_name}` }).first()).toBeVisible();

  // An admin deletes every photo.
  const admin = await signIn(browser, 'admin', '/admin');
  const section = admin.getByRole('region', { name: 'Photos' });
  await expect(section).toContainText(/\d+ photos? stored\./);
  admin.once('dialog', (dialog) => void dialog.accept());
  await section.getByRole('button', { name: 'Delete all photos' }).click();
  await expect(admin.getByText(/^Deleted \d+ photos?\.$/)).toBeVisible();
  await expect(section).toContainText('0 photos stored.');
});

// Put the shared dev database back: end our interview, let the panelist leave, delete our panel.
test.afterAll(async () => {
  const [qmApi, adminApi, panelist] = await Promise.all([apiAs('queue'), apiAs('admin'), apiAs('panelist3')]);
  await endCurrentInterview(qmApi).catch(() => undefined);
  await panelist.setMyPanel(null).catch(() => undefined);
  if (panelId) await adminApi.deletePanel(panelId).catch(() => undefined);
});
