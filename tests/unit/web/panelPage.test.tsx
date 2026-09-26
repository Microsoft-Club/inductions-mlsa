// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import type { BoardSnapshot, PanelInterview } from '../../../src/lib/types.ts';
import { board, boardPanel, candidateRow, interview, lane, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

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

async function openPanel(overrides: Partial<Api> = {}) {
  const api = fakeApi({ boardSnapshot: vi.fn(async () => boardWithMe()), ...overrides });
  const view = renderApp('/panel', { api, auth: fakeAuth({ signedInAs: profile('panelist') }).backend });
  return { ...view, api };
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

    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(api.endInterview).toHaveBeenCalledWith('i7');
  });

  it('keeps the last interview open after it ends, and lists earlier ones with pending evaluations', async () => {
    const { api } = await openPanel({
      boardSnapshot: vi.fn(async () => boardWithMe({ current: null })),
      candidate: vi.fn(async (id: string) => candidateRow({ id, number: Number(id.slice(1)), full_name: id === 'c5' ? 'Hina Tariq' : 'Sara Ahmed' })),
      panelInterviews: vi.fn(async () => [past(7, 'Sara Ahmed'), past(6, 'Omar Farooq'), past(5, 'Hina Tariq')]),
      myEvaluations: vi.fn(async () => [{ interview_id: 'i6', scores: {}, recommendation: 'yes' as const, comments: '', updated_at: '2026-09-26T10:01:00Z' }]),
    });
    expect(await screen.findByText(/^Interview ended/)).toBeInTheDocument();
    const recent = await screen.findByRole('region', { name: 'Recent' });
    await waitFor(() => expect(within(recent).getAllByRole('listitem')).toHaveLength(2));
    const [omar, hina] = within(recent).getAllByRole('listitem');
    expect(omar).not.toHaveTextContent('Evaluation pending');
    expect(hina).toHaveTextContent('Evaluation pending');

    await userEvent.click(within(hina).getByRole('button', { name: '#5 Hina Tariq' }));
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
