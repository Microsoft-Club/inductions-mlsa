// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NETWORK_ERROR, type Api } from '../../../src/lib/api.ts';
import type { BoardSnapshot, MyEvaluationWithInterview, PanelInterview, Recommendation } from '../../../src/lib/types.ts';
import { board, boardPanel, candidateRow, criteriaList, interview, lane, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp, type FakeApi } from './helpers.tsx';

const me = { id: 'u-panelist', display_name: 'Test panelist' };

/** Panel 1 with you in it; by default #7 Sara Ahmed is being interviewed and #12 is lined up. */
function boardWithMe(panel1: Parameters<typeof boardPanel>[2] = {}, overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return board({
    panels: [
      boardPanel('p1', 'Panel 1', { is_default: true, current: interview(7, 'Sara Ahmed'), lane: lane([12, 'Ali Raza']), panelists: [me], ...panel1 }),
      boardPanel('p2', 'Panel 2', { is_default: true }),
    ],
    ...overrides,
  });
}

const past = (n: number, name: string, status: PanelInterview['status'] = 'ended'): PanelInterview => ({
  id: `i${n}`, status, started_at: `2026-09-26T09:${String(n).padStart(2, '0')}:00Z`, ended_at: status === 'ended' ? '2026-09-26T10:00:00Z' : null,
  candidate: { id: `c${n}`, number: n, full_name: name },
});

/** Your evaluation of an interview, as myEvaluations returns it. */
const mine = (i: PanelInterview, panel: string, recommendation: Recommendation = 'yes'): MyEvaluationWithInterview => ({
  interview_id: i.id, scores: {}, recommendation, comments: '', updated_at: '2026-09-26T10:01:00Z', interview: { ...i, panel: { name: panel } },
});

async function openPanel(overrides: Partial<Api> = {}, path = '/panel') {
  const api = fakeApi({ boardSnapshot: vi.fn(async () => boardWithMe()), ...overrides });
  const view = renderApp(path, { api, auth: fakeAuth({ signedInAs: profile('panelist') }).backend });
  return { ...view, api };
}

/** The panelist's own sections: Interview, Recent, Evaluated, Find a candidate. */
const sections = () => screen.getByRole('tablist', { name: 'Sections' });
async function openSection(name: string | RegExp) {
  await userEvent.click(within(await screen.findByRole('tablist', { name: 'Sections' })).getByRole('tab', { name }));
}

describe('the panelist screen', () => {
  it('asks which panel you are sitting in on your first visit', async () => {
    const { api } = await openPanel({ boardSnapshot: vi.fn(async () => board()) });
    expect(await screen.findByRole('heading', { name: 'Which panel are you sitting in?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Panel 2' }));
    expect(api.setMyPanel).toHaveBeenCalledWith('p2');
  });

  it('shows the candidate being interviewed with the application, the discussion and your evaluation', async () => {
    const { api } = await openPanel();
    expect(await screen.findByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
    expect(api.candidate).toHaveBeenCalledWith('c7');
    expect(screen.getByRole('region', { name: 'Application' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Discussion' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'My evaluation' })).toBeInTheDocument();
    expect(api.subscribeInterview).toHaveBeenCalledWith('i7');
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Up next: #12 Ali Raza')).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(api.endInterview).toHaveBeenCalledWith('i7');
    confirm.mockRestore();
  });

  it('keeps the last interview open after it ends, and lists earlier ones with pending evaluations', async () => {
    const { api } = await openPanel({
      boardSnapshot: vi.fn(async () => boardWithMe({ current: null })),
      candidate: vi.fn(async (id: string) => candidateRow({ id, number: Number(id.slice(1)), full_name: id === 'c5' ? 'Hina Tariq' : 'Sara Ahmed' })),
      panelInterviews: vi.fn(async () => [past(7, 'Sara Ahmed'), past(6, 'Omar Farooq'), past(5, 'Hina Tariq')]),
      myEvaluations: vi.fn(async () => [mine(past(6, 'Omar Farooq'), 'Panel 1')]),
    });
    expect(await screen.findByText(/^Interview ended/)).toBeInTheDocument();
    await openSection(/^Recent/);
    const recent = await screen.findByRole('region', { name: 'Recent' });
    await waitFor(() => expect(within(recent).getAllByRole('listitem')).toHaveLength(2));
    const [omar, hina] = within(recent).getAllByRole('listitem');
    expect(omar).not.toHaveTextContent('Evaluation pending');
    expect(hina).toHaveTextContent('Evaluation pending');

    await userEvent.click(within(hina).getByRole('button', { name: '#5 Hina Tariq' }));
    expect(within(sections()).getByRole('tab', { name: 'Interview' })).toHaveAttribute('aria-selected', 'true'); // opens in Interview
    expect(await screen.findByRole('heading', { name: '#5 Hina Tariq' })).toBeInTheDocument();
    expect(api.candidate).toHaveBeenLastCalledWith('c5');
    await userEvent.click(screen.getByRole('button', { name: 'Back to the current interview' }));
    expect(await screen.findByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
  });

  it('switches panel from the header', async () => {
    const { api } = await openPanel();
    await screen.findByRole('heading', { name: '#7 Sara Ahmed' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Your panel' }), 'Panel 2');
    expect(api.setMyPanel).toHaveBeenCalledWith('p2');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Your panel' }), 'Not in a panel');
    expect(api.setMyPanel).toHaveBeenLastCalledWith(null);
  });

  it('locks evaluations once results are published', async () => {
    const published = boardWithMe({}, { induction: { id: 'ind-1', name: 'Fall 2026', target_interview_minutes: 15, results_published: true } });
    await openPanel({ boardSnapshot: vi.fn(async () => published) });
    const form = await screen.findByRole('region', { name: 'My evaluation' });
    expect(within(form).getByText('Results are published; evaluations are locked.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Submit evaluation' })).toBeDisabled();
  });

  it("opens any candidate's application read-only from search", async () => {
    const { api } = await openPanel({
      listCandidates: vi.fn(async () => [{ id: 'c5', number: 5, full_name: 'Hina Tariq', reg_number: '2025005', status: 'registered' as const }]),
      candidate: vi.fn(async (id: string) => candidateRow({ id, number: id === 'c5' ? 5 : 7, full_name: id === 'c5' ? 'Hina Tariq' : 'Sara Ahmed' })),
    });
    await screen.findByRole('heading', { name: '#7 Sara Ahmed' });
    await openSection('Find a candidate');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a candidate' }), 'hina');
    await userEvent.click(await screen.findByRole('button', { name: /#5 Hina Tariq/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Application of #5 Hina Tariq' });
    expect(within(dialog).getByRole('tablist', { name: 'Application sections' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'End interview' })).toBeNull();
    expect(api.candidate).toHaveBeenLastCalledWith('c5');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the candidates you evaluated', () => {
  const zara = past(3, 'Zara Ali');
  const omar = past(6, 'Omar Farooq');
  const bilal = past(9, 'Bilal Khan');
  const choose = (scope: HTMLElement, group: string, option: string) =>
    userEvent.click(within(within(scope).getByRole('group', { name: group })).getByRole('radio', { name: option }));

  it('lists everyone you evaluated in this induction, from any panel, newest first', async () => {
    const { api } = await openPanel({
      myEvaluations: vi.fn(async () => [mine(omar, 'Panel 1', 'maybe'), mine(zara, 'Panel 2', 'strong_yes'), mine(bilal, 'Panel 1', 'no')]),
    });
    await openSection(/^Evaluated/);
    const list = await screen.findByRole('region', { name: 'Candidates you evaluated' });
    expect(within(list).getByRole('heading')).toHaveTextContent('Candidates you evaluated (3)');
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('button').textContent)).toEqual(['#9 Bilal Khan', '#6 Omar Farooq', '#3 Zara Ali']);
    expect(rows[2]).toHaveTextContent('Panel 2');
    expect(rows[2]).toHaveTextContent('Strong Yes');
    expect(rows[0]).toHaveTextContent('No');
    expect(api.myEvaluations).toHaveBeenCalledWith('u-panelist', 'ind-1');
  });

  it('opens a candidate you evaluated in another panel, with your evaluation filled in', async () => {
    const { api } = await openPanel({
      candidate: vi.fn(async (id: string) => candidateRow({ id, number: Number(id.slice(1)), full_name: id === 'c3' ? 'Zara Ali' : 'Sara Ahmed' })),
      myEvaluations: vi.fn(async () => [{ ...mine(zara, 'Panel 2', 'strong_yes'), scores: { communication: 5 } }]),
    });
    await openSection(/^Evaluated/);
    const list = await screen.findByRole('region', { name: 'Candidates you evaluated' });
    await userEvent.click(within(list).getByRole('button', { name: '#3 Zara Ali' }));
    expect(await screen.findByRole('heading', { name: '#3 Zara Ali' })).toBeInTheDocument();
    expect(api.candidate).toHaveBeenLastCalledWith('c3');
    const form = await screen.findByRole('region', { name: 'My evaluation' });
    expect(within(within(form).getByRole('group', { name: 'Overall recommendation' })).getByRole('radio', { name: 'Strong Yes' })).toBeChecked();
    expect(within(within(form).getByRole('group', { name: 'Communication' })).getByRole('radio', { name: '5' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Back to the current interview' }));
    expect(await screen.findByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
  });

  it('refreshes the list when you open a candidate, so their interview shows as it is now', async () => {
    let endedSince = false; // Panel 2 finished with Zara after you left it
    await openPanel({
      candidate: vi.fn(async (id: string) => candidateRow({ id, number: Number(id.slice(1)), full_name: id === 'c3' ? 'Zara Ali' : 'Sara Ahmed' })),
      myEvaluations: vi.fn(async () => [mine(endedSince ? zara : past(3, 'Zara Ali', 'in_progress'), 'Panel 2')]),
    });
    await openSection(/^Evaluated/);
    const list = await screen.findByRole('region', { name: 'Candidates you evaluated' });
    endedSince = true;
    await userEvent.click(within(list).getByRole('button', { name: '#3 Zara Ali' }));
    expect(await screen.findByRole('heading', { name: '#3 Zara Ali' })).toBeInTheDocument();
    expect(await screen.findByText(/^Interview ended/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End interview' })).toBeNull();
  });

  it('adds the candidate as soon as you submit your evaluation', async () => {
    let submitted = false;
    await openPanel({
      myEvaluations: vi.fn(async () => (submitted ? [mine(past(7, 'Sara Ahmed', 'in_progress'), 'Panel 1')] : [])),
      submitEvaluation: vi.fn(async () => {
        submitted = true;
      }),
    });
    await openSection(/^Evaluated/);
    const list = await screen.findByRole('region', { name: 'Candidates you evaluated' });
    expect(within(list).getByText("You haven't evaluated anyone yet.")).toBeInTheDocument();
    await openSection('Interview');
    const form = await screen.findByRole('region', { name: 'My evaluation' });
    await choose(form, 'Overall recommendation', 'Yes');
    await userEvent.click(within(form).getByRole('button', { name: 'Submit evaluation' }));
    await openSection(/^Evaluated/);
    expect(await within(screen.getByRole('region', { name: 'Candidates you evaluated' })).findByRole('button', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
  });
});

describe('on a phone', () => {
  it('shows the newest messages when the Chat tab is opened', async () => {
    const msg = (id: string, body: string) => ({ id, interview_id: 'i7', author_id: 'u1', author_name: 'Hamza', body, created_at: '2026-09-26T09:55:00Z' });
    await openPanel({ interviewMessages: vi.fn(async () => [msg('m1', 'First'), msg('m2', 'Second')]) });
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('Second');
    Object.defineProperty(log, 'scrollHeight', { value: 480, configurable: true });
    log.scrollTop = 0; // it was hidden behind the Application tab, so it never scrolled
    await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(log.scrollTop).toBe(480);
  });
});

describe('switching panel', () => {
  it("starts fresh in the new panel, without the old panel's interviews", async () => {
    let where = 'p1';
    const { api } = await openPanel({
      boardSnapshot: vi.fn(async () =>
        where === 'p1'
          ? boardWithMe({ current: null })
          : board({ panels: [boardPanel('p1', 'Panel 1', { is_default: true }), boardPanel('p2', 'Panel 2', { is_default: true, panelists: [me] })] }),
      ),
      panelInterviews: vi.fn((panelId: string) =>
        panelId === 'p1' ? Promise.resolve([past(7, 'Sara Ahmed'), past(6, 'Omar Farooq')]) : new Promise<PanelInterview[]>(() => {}),
      ),
    });
    await openSection(/^Recent/);
    const recent = await screen.findByRole('region', { name: 'Recent' });
    await waitFor(() => expect(within(recent).getAllByRole('listitem')).toHaveLength(1));
    await userEvent.click(within(recent).getByRole('button', { name: '#6 Omar Farooq' }));
    expect(await screen.findByRole('button', { name: 'Back to the current interview' })).toBeInTheDocument();

    where = 'p2'; // moved to Panel 2 (from another tab); Panel 2's interviews are still loading
    (api as FakeApi).topics.board.event();
    expect(await screen.findByRole('heading', { level: 1, name: 'Panel 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to the current interview' })).toBeNull();
    expect(screen.queryByText('Omar Farooq')).toBeNull();
    expect(screen.getByText('Nobody has been interviewed in Panel 2 yet', { exact: false })).toBeInTheDocument();
  });
});

describe('the panelist screen on a bad connection', () => {
  const saved = { ...mine(past(6, 'Omar Farooq'), 'Panel 1'), scores: { communication: 4 } };
  const offline = () => Promise.reject(new ApiError(NETWORK_ERROR));

  /** Criteria and your evaluations fail until `net.online` is set; each board read has a new server time. */
  function flaky() {
    const net = { online: false };
    let reads = 0;
    const overrides = {
      boardSnapshot: vi.fn(async () => boardWithMe({}, { server_time: `2026-09-26T10:00:${String(reads++ % 60).padStart(2, '0')}Z` })),
      criteria: vi.fn(async () => (net.online ? criteriaList() : offline())),
      myEvaluations: vi.fn(async () => (net.online ? [saved] : offline())),
      panelInterviews: vi.fn(async () => [past(7, 'Sara Ahmed', 'in_progress'), past(6, 'Omar Farooq')]),
    } satisfies Partial<Api>;
    return { net, overrides };
  }

  it('never shows the evaluation form without its criteria, and loads it when the board reloads', async () => {
    const { net, overrides } = flaky();
    const { api } = await openPanel(overrides);
    expect(await screen.findByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
    expect(await screen.findByText(/Couldn't load your evaluation form/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'My evaluation' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Your numbers' })).toHaveTextContent(/Evaluated\s*—/); // unknown, not zero
    await openSection(/^Recent/);
    const recent = await screen.findByRole('region', { name: 'Recent' });
    await waitFor(() => expect(within(recent).getAllByRole('listitem')).toHaveLength(1));
    expect(within(recent).getByRole('listitem')).not.toHaveTextContent('Evaluation pending'); // unknown, not pending

    net.online = true;
    (api as FakeApi).topics.board.event(); // the board reloads, as it does after reconnecting
    await openSection('Interview');
    const form = await screen.findByRole('region', { name: 'My evaluation' });
    expect(within(form).getByRole('group', { name: 'Communication' })).toBeInTheDocument();
  });

  it('offers Try again for the evaluation form', async () => {
    const { net, overrides } = flaky();
    await openPanel({ ...overrides, boardSnapshot: vi.fn(async () => boardWithMe()) });
    expect(await screen.findByText(/Couldn't load your evaluation form/)).toBeInTheDocument();
    net.online = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'My evaluation' })).toBeInTheDocument();
  });

  it('offers Try again when the application does not load', async () => {
    let online = false;
    await openPanel({ candidate: vi.fn(async (id: string) => (online ? candidateRow({ id }) : offline())) });
    expect(await screen.findByText(NETWORK_ERROR)).toBeInTheDocument();
    online = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
  });
});

describe('your numbers and sections', () => {
  const setup = () => ({
    boardSnapshot: vi.fn(async () => boardWithMe()), // #7 Sara Ahmed is being interviewed
    panelInterviews: vi.fn(async () => [past(7, 'Sara Ahmed', 'in_progress'), past(6, 'Omar Farooq'), past(5, 'Hina Tariq')]),
    myEvaluations: vi.fn(async () => [mine(past(6, 'Omar Farooq'), 'Panel 1'), mine(past(3, 'Zara Ali'), 'Panel 2')]),
  });

  it('shows how many you interviewed and evaluated, and four sections with Interview first', async () => {
    await openPanel(setup());
    const numbers = await screen.findByRole('region', { name: 'Your numbers' });
    await waitFor(() => expect(numbers).toHaveTextContent(/Interviewed\s*3/));
    expect(numbers).toHaveTextContent(/Evaluated\s*2/);
    expect(numbers).toHaveTextContent(/Pending\s*1/); // Hina; Sara's interview is still going on
    const tabs = within(sections()).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Interview', 'Recent 1 pending', 'Evaluated 2', 'Find a candidate']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull(); // hidden until chosen
  });

  it('keeps the chosen section in the address, so a reload opens it again', async () => {
    const { router } = await openPanel(setup(), '/panel?view=evaluated');
    await waitFor(() => expect(within(sections()).getByRole('tab', { name: /^Evaluated/ })).toHaveAttribute('aria-selected', 'true'));
    expect(await screen.findByRole('region', { name: 'Candidates you evaluated' })).toBeInTheDocument();
    await openSection(/^Recent/);
    expect(router.state.location.search).toBe('?view=recent');
    await openSection('Interview');
    expect(router.state.location.search).toBe('');
  });

  it('shows the newest message again when you come back to the interview', async () => {
    const msg = (id: string, body: string) => ({ id, interview_id: 'i7', author_id: 'u1', author_name: 'Hamza', body, created_at: '2026-09-26T09:55:00Z' });
    await openPanel({ ...setup(), interviewMessages: vi.fn(async () => [msg('m1', 'First'), msg('m2', 'Second')]) });
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('Second');
    await openSection(/^Recent/);
    Object.defineProperty(log, 'scrollHeight', { value: 480, configurable: true });
    log.scrollTop = 0; // messages arrived while the interview was hidden
    await openSection('Interview');
    expect(log.scrollTop).toBe(480);
  });
});
