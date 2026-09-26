// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import type { ResultRow } from '../../../src/lib/types.ts';
import { downloadCsv } from '../../../src/results/download.ts';
import { candidateRecordFor, candidateRow, profile, resultRow } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

vi.mock('../../../src/results/download.ts', () => ({ downloadCsv: vi.fn() }));

const rows = [
  resultRow({ candidate_id: 'c7', number: 7, full_name: 'Sara Ahmed', general_avg: 3.75, status: 'interviewed' }),
  resultRow({ candidate_id: 'c2', number: 2, full_name: 'Ali Raza', reg_number: '2025002', general_avg: null, evaluation_count: 0, status: 'registered', recommendations: {}, criteria_avgs: {} }),
  resultRow({ candidate_id: 'c9', number: 9, full_name: 'Bilal Khan', reg_number: '2025009', general_avg: 4.5, decision: 'selected', status: 'interviewed' }),
];

async function openResults(path = '/results', overrides: Partial<Api> = {}) {
  const api = fakeApi({ resultsTable: vi.fn(async () => rows), ...overrides });
  const view = renderApp(path, { api, auth: fakeAuth({ signedInAs: profile('admin') }).backend });
  return { ...view, api };
}

const bodyRows = () => within(screen.getByRole('table', { name: 'Results' })).getAllByRole('row').slice(1);
const numbers = () => bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent);

describe('the results page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows every candidate with averages, team fit, the tally and the decision', async () => {
    await openResults();
    await screen.findByRole('table', { name: 'Results' });
    expect(numbers()).toEqual(['#2', '#7', '#9']);
    const sara = bodyRows()[1];
    expect(sara).toHaveTextContent('Sara Ahmed');
    expect(sara).toHaveTextContent('3.75');
    expect(sara).toHaveTextContent('1 Strong Yes · 1 Yes');
    expect(within(sara).getByRole('combobox', { name: 'Decision for #7 Sara Ahmed' })).toHaveValue('undecided');
    expect(within(sara).getByRole('link', { name: 'Sara Ahmed' })).toHaveAttribute('href', '/results/c7');
    expect(screen.getByRole('columnheader', { name: /Dev/ })).toBeInTheDocument();
  });

  it('says which panel interviewed each candidate', async () => {
    await openResults('/results', {
      resultsTable: vi.fn(async () => [
        resultRow({ candidate_id: 'c7', number: 7, panels: ['Panel 2'] }),
        resultRow({ candidate_id: 'c2', number: 2, full_name: 'Ali Raza', panels: [] }),
        resultRow({ candidate_id: 'c9', number: 9, full_name: 'Bilal Khan', panels: ['Panel 1', 'Panel 3'] }),
      ]),
    });
    await screen.findByRole('table', { name: 'Results' });
    const column = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === 'Panel');
    expect(column).toBeGreaterThan(-1);
    expect(bodyRows().map((row) => within(row).getAllByRole('cell')[column].textContent)).toEqual(['—', 'Panel 2', 'Panel 1, Panel 3']);
  });

  it('filters by status and decision, and sorts by a column', async () => {
    await openResults();
    await screen.findByRole('table', { name: 'Results' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'interviewed');
    expect(numbers()).toEqual(['#7', '#9']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Decision' }), 'selected');
    expect(numbers()).toEqual(['#9']);
    expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Decision' }), 'all');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'all');
    await userEvent.click(screen.getByRole('button', { name: 'General avg' }));
    expect(numbers()).toEqual(['#9', '#7', '#2']); // highest first, no scores last
    expect(screen.getByRole('columnheader', { name: 'General avg' })).toHaveAttribute('aria-sort', 'descending');
  });

  it('records a decision', async () => {
    const { api } = await openResults();
    await screen.findByRole('table', { name: 'Results' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Decision for #7 Sara Ahmed' }), 'selected');
    expect(api.setDecision).toHaveBeenCalledWith('c7', 'selected');
    await waitFor(() => expect(api.resultsTable).toHaveBeenCalledTimes(2));
  });

  it('publishes after confirming, and can unpublish', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api } = await openResults();
    await userEvent.click(await screen.findByRole('button', { name: 'Publish results' }));
    expect(window.confirm).toHaveBeenCalledWith(
      'Publish results? Everyone marked Selected appears on the public page, and panelists can no longer change their evaluations.',
    );
    expect(api.setResultsPublished).toHaveBeenCalledWith(true);

    vi.mocked(api.induction).mockResolvedValue({ id: 'ind-1', name: 'Fall 2026', target_interview_minutes: 15, results_published: true });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Published')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the public page' })).toHaveAttribute('href', '/selected');
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    expect(api.setResultsPublished).toHaveBeenLastCalledWith(false);
  });

  it('exports both CSV files', async () => {
    const { api } = await openResults();
    await screen.findByRole('table', { name: 'Results' });
    await userEvent.click(screen.getByRole('button', { name: 'Export candidates' }));
    const [name, csv] = vi.mocked(downloadCsv).mock.calls[0];
    expect(name).toMatch(/^fall-2026-candidates-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.split('\r\n')).toHaveLength(4); // header + 3 candidates, whatever the filters

    await userEvent.click(screen.getByRole('button', { name: 'Export evaluations' }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(2));
    expect(api.evaluationsExport).toHaveBeenCalled();
    expect(vi.mocked(downloadCsv).mock.calls[1][0]).toMatch(/^fall-2026-evaluations-/);
  });
});

describe('the results page with other admins at work', () => {
  it('exports the latest decisions, not the table on screen', async () => {
    let table = rows;
    await openResults('/results', { resultsTable: vi.fn(async () => table) });
    await screen.findByRole('table', { name: 'Results' });
    table = rows.map((r) => (r.candidate_id === 'c7' ? { ...r, decision: 'selected' as const } : r)); // another admin decided
    vi.mocked(downloadCsv).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Export candidates' }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    const csv = vi.mocked(downloadCsv).mock.calls[0][1];
    expect(csv.split('\r\n').find((line) => line.startsWith('7,'))).toMatch(/,Selected$/);
  });

  it('keeps the newest answer when two reloads come back out of order', async () => {
    const answers: Array<(value: ResultRow[]) => void> = [];
    let calls = 0;
    await openResults('/results', {
      resultsTable: vi.fn(() => (calls++ === 0 ? Promise.resolve(rows) : new Promise<ResultRow[]>((resolve) => answers.push(resolve)))),
    });
    await screen.findByRole('table', { name: 'Results' });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(answers).toHaveLength(2));
    const decision = () => screen.getByRole('combobox', { name: 'Decision for #9 Bilal Khan' });

    answers[1](rows.map((r) => (r.candidate_id === 'c9' ? { ...r, decision: 'not_selected' as const } : r)));
    await waitFor(() => expect(decision()).toHaveValue('not_selected'));
    answers[0](rows); // the older reload answers last
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(decision()).toHaveValue('not_selected');
  });
});

describe('a candidate record', () => {
  it('shows the application, every interview with its discussion, and every evaluation', async () => {
    const { api } = await openResults('/results/c7', { candidateRecord: vi.fn(async () => candidateRecordFor(candidateRow())) });
    expect(await screen.findByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
    expect(api.candidateRecord).toHaveBeenCalledWith('c7');
    expect(screen.getByRole('region', { name: 'Application' })).toBeInTheDocument();
    const interview = screen.getByRole('region', { name: 'Panel 1 interview' });
    expect(interview).toHaveTextContent('16:30');
    expect(within(interview).getByText('Strong on teamwork.')).toBeInTheDocument();
    const evaluations = within(interview).getByRole('table', { name: 'Evaluations' });
    expect(within(evaluations).getAllByRole('row')).toHaveLength(3);
    expect(evaluations).toHaveTextContent('Strong Yes');
    expect(evaluations).toHaveTextContent('Great fit.');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Decision for #7 Sara Ahmed' }), 'not_selected');
    expect(api.setDecision).toHaveBeenCalledWith('c7', 'not_selected');
    expect(screen.getByRole('link', { name: '← All results' })).toHaveAttribute('href', '/results');
  });

  it('shows two evaluations from panelists with the same name', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const record = candidateRecordFor(candidateRow());
    record.interviews[0].evaluations = record.interviews[0].evaluations.map((e) => ({ ...e, panelist_name: 'Ali' }));
    await openResults('/results/c7', { candidateRecord: vi.fn(async () => record) });
    const evaluations = await screen.findByRole('table', { name: 'Evaluations' });
    expect(within(evaluations).getAllByRole('row')).toHaveLength(3);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });

  it("colours each panelist's name in the discussion", async () => {
    const record = candidateRecordFor(candidateRow());
    const say = (id: string, author_id: string, author_name: string) => ({
      id, interview_id: 'i7', author_id, author_name, body: `${author_name} says hi`, created_at: '2026-09-26T09:55:00Z',
    });
    record.interviews[0].messages = [say('m1', 'u1', 'Hamza'), say('m2', 'u2', 'Mariam'), say('m3', 'u1', 'Hamza')];
    await openResults('/results/c7', { candidateRecord: vi.fn(async () => record) });
    const interview = await screen.findByRole('region', { name: 'Panel 1 interview' });
    const colourOf = (el: HTMLElement) => [...el.classList].find((c) => /^text-[a-z]+-\d{3}$/.test(c));
    const [first, again] = within(interview).getAllByText('Hamza', { selector: 'span' }).map(colourOf);
    const mariam = colourOf(within(interview).getByText('Mariam', { selector: 'span' }));
    expect(first).toBeDefined();
    expect(first).toBe(again);
    expect(mariam).not.toBe(first);
  });
});
