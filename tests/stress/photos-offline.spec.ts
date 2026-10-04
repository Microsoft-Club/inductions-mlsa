// Photos when the connection drops: the photographer saving offline, and a panelist whose first photo download fails.
import { expect, test, type Page } from '@playwright/test';
import { createApi, type Api } from '../../src/lib/api.ts';
import { makeAccount, signIn as apiSignIn, uniqueName, TEST_PASSWORD } from '../integration/support.ts';
import { sql } from './db.ts';

const RUN = Date.now().toString(36).toUpperCase();
let seq = 0;

async function person(role: 'queue_manager' | 'panelist' | 'photographer') {
  const username = uniqueName(`np_${role.slice(0, 3)}`);
  const id = await makeAccount(username, role);
  return { username, id, api: createApi(await apiSignIn(username)) as Api };
}
async function signInPage(page: Page, username: string, path: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(path);
}
async function jpeg(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#16a34a';
    g.fillRect(0, 0, 1200, 900);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}
/** Looked up by reg number in the database: the candidate list stops at 1,000 rows, and this database fills up. */
function byReg(reg: string): { id: string; number: number } {
  const [id, number] = sql(`select id, number from public.candidates where reg_number = '${reg}' and induction_id = (select id from public.inductions where is_active)`).split('|');
  return { id, number: Number(number) };
}
async function waitingCandidate(desk: Awaited<ReturnType<typeof person>>) {
  const reg = `PN${RUN}${++seq}`;
  const name = `Photo Net ${RUN} ${seq}`;
  await desk.api.importCandidates([{ submitted_at: new Date().toISOString(), reg_number: reg, full_name: name, email: '', account_email: '', phone: '', department: '', batch: '', preferences: ['', '', '', ''], answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [] } }] as never);
  const c = byReg(reg);
  await desk.api.checkIn(c.id);
  return { id: c.id, number: c.number, name };
}

test('the photographer saves with no signal, then again once back: the photo is kept', async ({ browser }) => {
  const desk = await person('queue_manager');
  const photographer = await person('photographer');
  const c = await waitingCandidate(desk);
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  await signInPage(page, photographer.username, '/photos');
  await page.getByRole('list', { name: 'Needs photo' }).getByRole('button', { name: `#${c.number} ${c.name}` }).click();
  const capture = page.getByRole('dialog', { name: `Photo of #${c.number} ${c.name}` });
  await capture.getByLabel('Photo file').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await jpeg(page) });
  await expect(capture.getByRole('img', { name: `New photo of ${c.name}` })).toBeVisible();
  await context.setOffline(true);
  await capture.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/reach the server|took too long/i).first()).toBeVisible();
  await expect(capture.getByRole('img', { name: `New photo of ${c.name}` }), 'the photo taken is still there to save').toBeVisible();
  await context.setOffline(false);
  await capture.getByRole('button', { name: 'Try again' }).click();
  await expect(capture).toBeHidden();
  await expect(page.getByRole('list', { name: 'Done' }).getByRole('img', { name: `Photo of ${c.name}` })).toBeVisible();
});

test("a panelist's first photo download fails: the face still shows during the interview", async ({ browser }) => {
  const desk = await person('queue_manager');
  const photographer = await person('photographer');
  const panelist = await person('panelist');
  const c = await waitingCandidate(desk);
  // The photographer takes the photo.
  const photoCtx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const photoPage = await photoCtx.newPage();
  await signInPage(photoPage, photographer.username, '/photos');
  await photoPage.getByRole('list', { name: 'Needs photo' }).getByRole('button', { name: `#${c.number} ${c.name}` }).click();
  const capture = photoPage.getByRole('dialog', { name: `Photo of #${c.number} ${c.name}` });
  await capture.getByLabel('Photo file').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await jpeg(photoPage) });
  await capture.getByRole('button', { name: 'Save' }).click();
  await expect(capture).toBeHidden();
  // Sent in to a panel; the panelist's first download of the photo fails (a blip).
  const panel = await desk.api.addPanel();
  await panelist.api.setMyPanel(panel);
  const interview = (await desk.api.sendIn(c.id, panel))!;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let failed = 0;
  await page.route('**/api/photos/**', async (route) => {
    if (route.request().method() === 'GET' && failed === 0) {
      failed++;
      await route.abort('internetdisconnected');
    } else await route.fallback();
  });
  await signInPage(page, panelist.username, '/panel');
  await expect(page.getByRole('heading', { name: `#${c.number} ${c.name}` })).toBeVisible();
  await expect.poll(() => failed).toBe(1);
  // The interview goes on; chat and board updates happen as usual.
  await panelist.api.postMessage(interview, 'board keeps moving', crypto.randomUUID());
  await waitingCandidate(desk);
  await expect(page.getByRole('img', { name: `Photo of ${c.name}` }).first(), 'the photo appears without a reload').toBeVisible({ timeout: 30_000 });
  await desk.api.endInterview(interview);
  await panelist.api.setMyPanel(null);
  await desk.api.deletePanel(panel).catch(() => {});
});
