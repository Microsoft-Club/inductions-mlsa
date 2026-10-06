// A panelist who moves panel before evaluating the candidate they sat in still finds that candidate:
// it stays in Recent, marked with the panel they left, until they evaluate it. The server doesn't
// record who sat in an interview, so this is remembered in the browser. Uses two panels of its own.
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localEnv } from '../../scripts/lib/local-env.ts';
import { usernameToEmail } from '../../supabase/functions/_shared/accounts.ts';
import { createApi, type Api } from '../../src/lib/api.ts';

const PASSWORD = 'induction-dev';
const stamp = String(Date.now()).slice(-6);
const candidateName = `Moving Test ${stamp}`;
const panelIds: string[] = [];
let interviewId: string | null = null;

async function apiAs(username: string): Promise<Api> {
  const env = localEnv();
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: usernameToEmail(username), password: PASSWORD });
  if (error) throw error;
  return createApi(client);
}

async function pickPanel(page: Page, name: string): Promise<void> {
  const chooser = page.getByRole('heading', { name: 'Which panel are you sitting in?' });
  if (await chooser.isVisible()) await page.getByRole('button', { name, exact: true }).click();
  else {
    page.once('dialog', (dialog) => void dialog.accept()); // "The interview ... is still on. Switch anyway?"
    await page.getByRole('button', { name: 'Switch panel' }).click();
    await page.getByRole('group', { name: 'Switch to' }).getByRole('button', { name, exact: true }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('an interview left mid-way stays in Recent until evaluated', async ({ browser }) => {
  const [admin, qm, me] = await Promise.all([apiAs('admin'), apiAs('queue'), apiAs('panelist4')]);
  await me.setMyPanel(null);
  panelIds.push(await admin.addPanel(), await admin.addPanel());
  const board = await qm.boardSnapshot();
  const [left, joined] = panelIds.map((id) => board.panels.find((p) => p.id === id)!.name);
  await qm.importCandidates([{
    submitted_at: new Date().toISOString(), reg_number: `MV${stamp}`, full_name: candidateName, email: '', account_email: '',
    phone: '', department: 'Test', batch: 'B00', preferences: [], answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [] },
  }]);
  const candidate = (await qm.listCandidates(board.induction.id)).find((c) => c.full_name === candidateName)!;
  await qm.checkIn(candidate.id);

  // The panelist sits in the first panel and the candidate is sent in there.
  const page = await (await browser.newContext()).newPage();
  await page.goto('/panel');
  await page.getByLabel('Username').fill('panelist4');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Which panel are you sitting in?' })).toBeVisible();
  await pickPanel(page, left);
  interviewId = await qm.sendIn(candidate.id, panelIds[0]);
  const heading = `#${candidate.number} ${candidateName}`;
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();

  // Mid-interview, without evaluating, they move to the other panel.
  await pickPanel(page, joined);
  await expect(page.getByRole('heading', { name: heading })).toHaveCount(0);

  // Recent still has the candidate, marked with the panel they left.
  const tabs = page.getByRole('tablist', { name: 'Sections', exact: true });
  await tabs.getByRole('tab', { name: /^Recent/ }).click();
  const row = page.getByRole('region', { name: 'Recent' }).getByRole('listitem').filter({ hasText: candidateName });
  await expect(row).toContainText(`in ${left}`);
  await expect(row).toContainText('Evaluation pending');

  // It opens with the evaluation form but no End (only that panel's panelists may end it).
  await row.getByRole('button', { name: heading }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End interview' })).toHaveCount(0);
  const form = page.getByRole('region', { name: 'My evaluation' });
  await form.getByRole('group', { name: 'Communication' }).getByRole('radio', { name: '4', exact: true }).check({ force: true });
  await form.getByRole('group', { name: 'Overall recommendation' }).getByRole('radio', { name: 'Yes', exact: true }).check({ force: true });
  await form.getByRole('button', { name: 'Submit evaluation' }).click();
  await expect(page.getByText('Evaluation submitted')).toBeVisible();

  // Evaluated: gone from Recent, listed under Evaluated with the panel it was in.
  await page.getByRole('button', { name: 'Back to the current interview' }).click();
  await tabs.getByRole('tab', { name: /^Recent/ }).click();
  await expect(page.getByRole('region', { name: 'Recent' }).getByText(candidateName)).toHaveCount(0);
  await tabs.getByRole('tab', { name: /^Evaluated/ }).click();
  await expect(page.getByRole('region', { name: 'Candidates you evaluated' }).getByRole('listitem').filter({ hasText: candidateName }))
    .toContainText(`${left} · Yes`);
});

// Put the shared dev database back: out of the panel, interview ended, both panels deleted.
test.afterAll(async () => {
  const [admin, qm, me] = await Promise.all([apiAs('admin'), apiAs('queue'), apiAs('panelist4')]);
  await me.setMyPanel(null).catch(() => undefined);
  if (interviewId) await qm.endInterview(interviewId).catch(() => undefined);
  for (const id of panelIds) await admin.deletePanel(id).catch(() => undefined);
});
