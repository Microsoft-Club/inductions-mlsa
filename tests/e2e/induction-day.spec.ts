// The whole day in real browsers (spec §12): import → check in → line up → send in (projector
// updates) → two panelists chat → end → both evaluate → results → decide → publish → /selected.
// Uses the dev accounts from `npm run seed:dev` and a fresh candidate and panel of its own.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';
import { localEnv } from '../../scripts/lib/local-env.ts';
import { usernameToEmail } from '../../supabase/functions/_shared/accounts.ts';
import { createApi } from '../../src/lib/api.ts';

const PASSWORD = 'induction-dev';
const stamp = String(Date.now()).slice(-6);
const candidateName = `Eesha Test ${stamp}`;
const reg = `E2E${stamp}`;
let panelName: string | undefined; // the panel this test adds, removed again afterwards

/** The fake export's header plus one fresh response, written where the file picker can find it. */
function writeExport(path: string): void {
  const [header, first] = Papa.parse<string[]>(readFileSync('fixtures/form-export-fake.csv', 'utf8'), { skipEmptyLines: 'greedy' }).data;
  const row = [...first];
  row[0] = '9/26/2026 12:00:00';
  row[2] = candidateName;
  row[4] = reg;
  writeFileSync(path, Papa.unparse([header, row], { newline: '\r\n' }));
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
  const select = page.getByRole('combobox', { name: 'Your panel' });
  await expect(chooser.or(select)).toBeVisible();
  if (await chooser.isVisible()) await page.getByRole('button', { name, exact: true }).click();
  else await select.selectOption({ label: name });
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function evaluate(page: Page, recommendation: string, communication: string): Promise<void> {
  const form = page.getByRole('region', { name: 'My evaluation' });
  await form.getByRole('group', { name: 'Communication' }).getByRole('radio', { name: communication, exact: true }).check({ force: true });
  await form.getByRole('group', { name: 'Overall recommendation' }).getByRole('radio', { name: recommendation, exact: true }).check({ force: true });
  await form.getByRole('button', { name: 'Submit evaluation' }).click();
  await expect(page.getByText('Evaluation submitted')).toBeVisible();
}

test('an induction day from import to the published list', async ({ browser }, testInfo) => {
  const csvPath = testInfo.outputPath('responses.csv');
  writeExport(csvPath);

  // Queue manager: import, add a panel of our own, check the candidate in and line them up.
  const qm = await signIn(browser, 'queue', '/queue');
  await qm.getByRole('button', { name: 'Import CSV' }).click();
  await qm.getByLabel('CSV file').setInputFiles(csvPath);
  await qm.getByRole('button', { name: 'Import 1 response' }).click();
  await expect(qm.getByText('Added 1 · Updated 0')).toBeVisible();
  await qm.getByRole('button', { name: 'Done' }).click();

  const panelsBefore = await qm.getByRole('region', { name: /^Panel \d+$/ }).count();
  await qm.getByRole('button', { name: '+ Add panel' }).click();
  await expect(qm.getByRole('region', { name: /^Panel \d+$/ })).toHaveCount(panelsBefore + 1);
  panelName = (await qm.getByRole('region', { name: /^Panel \d+$/ }).last().getAttribute('aria-label'))!;

  await qm.getByRole('searchbox', { name: 'Search candidates' }).fill(reg);
  const result = qm.getByRole('list', { name: 'Search results' }).getByRole('listitem').filter({ hasText: reg });
  const number = Number((await result.textContent())!.match(/#(\d+)/)![1]);
  await result.getByRole('button', { name: `Check in #${number}`, exact: true }).click();
  await expect(result).toContainText('Waiting · pool');
  await qm.getByRole('searchbox', { name: 'Search candidates' }).fill('');
  await qm.getByRole('combobox', { name: `Line up #${number} for a panel`, exact: true }).selectOption({ label: panelName });

  // Projector (no login), from the admin's link.
  const admin = await signIn(browser, 'admin', '/admin');
  const projectorLink = (await admin.getByRole('link', { name: 'Open projector' }).getAttribute('href'))!;
  const projector = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await projector.goto(projectorLink);
  const tile = projector.getByRole('region', { name: panelName });
  await expect(tile.getByText(candidateName)).toBeVisible(); // "Up next"

  // Two panelists sit in the new panel.
  const first = await signIn(browser, 'panelist1', '/panel');
  const second = await signIn(browser, 'panelist2', '/panel');
  await joinPanel(first, panelName);
  await joinPanel(second, panelName);

  // Send in: the projector shows it within seconds, and both panelists see the application.
  await qm.getByRole('region', { name: panelName }).getByRole('button', { name: `Send #${number} in to ${panelName}` }).click();
  await expect(tile.getByText('Now interviewing')).toBeVisible();
  await expect(tile.getByText(candidateName)).toBeVisible();
  for (const page of [first, second]) {
    await expect(page.getByRole('heading', { name: `#${number} ${candidateName}` })).toBeVisible();
  }

  // They talk about the candidate.
  await first.getByRole('textbox', { name: 'Message' }).fill('Clear answers on ownership');
  await first.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(second.getByRole('log', { name: 'Messages' })).toContainText('Clear answers on ownership');

  // One of them ends the interview; both evaluate.
  first.once('dialog', (dialog) => {
    expect(dialog.message()).toBe(`End the interview with #${number} ${candidateName}?`);
    void dialog.accept();
  });
  await first.getByRole('button', { name: 'End interview' }).click();
  await expect(first.getByText(/^Interview ended/)).toBeVisible();
  await expect(tile.getByText('Free')).toBeVisible();
  await evaluate(first, 'Strong Yes', '5');
  await evaluate(second, 'Yes', '4');
  await expect(second.getByText('2 panelists have submitted')).toBeVisible();
  // Each panelist's own list of the candidates they evaluated (only their own recommendation).
  const mine = first.getByRole('region', { name: 'Candidates you evaluated' }).getByRole('listitem').filter({ hasText: `#${number} ${candidateName}` });
  await expect(mine).toContainText(`${panelName} · Strong Yes`);

  // Admin: results, decision, publish.
  await admin.goto('/results');
  await admin.getByRole('searchbox').fill(reg);
  const row = admin.getByRole('table', { name: 'Results' }).getByRole('row').filter({ hasText: reg });
  await expect(row).toContainText('1 Strong Yes · 1 Yes');
  await expect(row).toContainText('4.5');
  await expect(row).toContainText(panelName);
  await row.getByRole('combobox', { name: `Decision for #${number} ${candidateName}` }).selectOption('selected');
  await expect(row.getByRole('combobox')).toHaveValue('selected');
  admin.once('dialog', (dialog) => void dialog.accept());
  await admin.getByRole('button', { name: 'Publish results' }).click();
  await expect(admin.getByText('Published', { exact: true })).toBeVisible();

  // The public page lists the candidate.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/selected');
  await visitor.getByRole('searchbox', { name: 'Find your name or reg number' }).fill(reg);
  await expect(visitor.getByRole('list', { name: 'Selected candidates' })).toContainText(candidateName);
});

// Put the shared dev database back: unpublish, clear the decision, empty and delete our panel.
test.afterAll(async () => {
  const env = localEnv();
  const as = async (username: string) => {
    const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email: usernameToEmail(username), password: PASSWORD });
    return createApi(client);
  };
  const [admin, qm, first, second] = await Promise.all(['admin', 'queue', 'panelist1', 'panelist2'].map(as));
  await admin.setResultsPublished(false).catch(() => undefined);
  const board = await qm.boardSnapshot();
  const candidate = (await qm.listCandidates(board.induction.id)).find((c) => c.reg_number === reg);
  if (candidate) await admin.setDecision(candidate.id, 'undecided').catch(() => undefined);
  await first.setMyPanel(null).catch(() => undefined);
  await second.setMyPanel(null).catch(() => undefined);
  const panel = board.panels.find((p) => p.name === panelName);
  if (panel?.current) await qm.endInterview(panel.current.interview_id).catch(() => undefined);
  if (panel) await qm.deletePanel(panel.id).catch(() => undefined);
});
