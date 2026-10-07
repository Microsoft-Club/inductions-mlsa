// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISABLED_NOTICE } from '../../../src/auth/AuthProvider.tsx';
import { ApiError } from '../../../src/lib/api.ts';
import { notAllowed } from '../../../src/lib/notAllowed.ts';
import type { Role } from '../../../src/lib/types.ts';
import { board, boardPanel, candidateRow, ended, interview } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

const queueManager = (role: Role = 'queue_manager') =>
  fakeAuth({ signedInAs: { id: 'u-queue', username: 'queue', display_name: 'Queue', role, is_active: true, current_panel_id: null } });

async function openQueue(api = fakeApi(), role: Role = 'queue_manager') {
  const auth = queueManager(role);
  const view = renderApp('/queue', { api, auth: auth.backend });
  await screen.findByRole('region', { name: 'Panel 1' });
  return { ...view, api, auth };
}

describe('QueuePage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the counts, every panel and the waiting pool', async () => {
    await openQueue();
    const counts = screen.getByLabelText('Candidate counts');
    expect(counts).toHaveTextContent('Registered 40');
    expect(counts).toHaveTextContent('Interviewed 16');
    expect(screen.getByRole('region', { name: 'Panel 2' })).toBeInTheDocument();
    const pool = screen.getByRole('list', { name: 'Waiting pool' });
    expect(within(pool).getAllByRole('listitem')).toHaveLength(3);
    expect(within(pool).getByText('عائشہ خان')).toBeInTheDocument();
    expect(document.title).toBe('Queue · MLSA Induction');
  });

  it('highlights the first person in the pool when a free panel has nobody lined up', async () => {
    const api = fakeApi({
      boardSnapshot: vi.fn(async () =>
        board({ panels: [boardPanel('p1', 'Panel 1', { is_default: true, current: interview(7, 'Sara Ahmed') }), boardPanel('p3', 'Panel 3')] }),
      ),
    });
    await openQueue(api);
    const pool = screen.getByRole('list', { name: 'Waiting pool' });
    const [first, second] = within(pool).getAllByRole('listitem');
    expect(within(first).getByRole('button', { name: 'Send in → Panel 3' })).toHaveClass('bg-brand-600');
    expect(within(second).getByRole('button', { name: 'Send in → Panel 3' })).not.toHaveClass('bg-brand-600');

    await userEvent.click(within(first).getByRole('button', { name: 'Send in → Panel 3' }));
    expect(api.sendIn).toHaveBeenCalledWith('c20', 'p3');
  });

  it('asks before sending someone from the pool in to a panel that is still wrapping up', async () => {
    const api = fakeApi({
      boardSnapshot: vi.fn(async () =>
        board({ panels: [boardPanel('p1', 'Panel 1', { is_default: true, current: interview(7, 'Sara Ahmed') }), boardPanel('p3', 'Panel 3', { last_ended: ended(6, 'Omar', null) })] }),
      ),
    });
    await openQueue(api);
    const [first] = within(screen.getByRole('list', { name: 'Waiting pool' })).getAllByRole('listitem');
    expect(within(first).getByRole('button', { name: 'Send in → Panel 3' })).not.toHaveClass('bg-brand-600'); // no hint: not ready
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(within(first).getByRole('button', { name: 'Send in → Panel 3' }));
    expect(confirm).toHaveBeenCalledWith("Panel 3 hasn't said they're ready yet. Send #20 in anyway?");
    expect(api.sendIn).toHaveBeenCalledWith('c20', 'p3');
  });

  it('says the person was lined up instead when nobody is sitting in that panel', async () => {
    const api = fakeApi({
      boardSnapshot: vi.fn(async () =>
        board({ panels: [boardPanel('p1', 'Panel 1', { is_default: true, current: interview(7, 'Sara Ahmed') }), boardPanel('p3', 'Panel 3')] }),
      ),
      sendIn: vi.fn(async () => null), // the server lined them up: nobody is sitting in Panel 3
    });
    await openQueue(api);
    const [first] = within(screen.getByRole('list', { name: 'Waiting pool' })).getAllByRole('listitem');
    await userEvent.click(within(first).getByRole('button', { name: 'Send in → Panel 3' }));
    expect(await screen.findByText('Nobody is sitting in Panel 3 yet, so #20 is lined up for it. Send them in once a panelist has joined.')).toBeInTheDocument();
  });

  it('lines people up, skips them and undoes their check-in from the pool', async () => {
    const { api } = await openQueue();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Line up #21 for a panel' }), 'Panel 2');
    await userEvent.click(screen.getByRole('button', { name: 'Skip #20' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo check-in for #22' }));
    expect(api.moveCandidate).toHaveBeenCalledWith('c21', 'p2', null);
    expect(api.skipCandidate).toHaveBeenCalledWith('c20');
    expect(window.confirm).toHaveBeenCalledWith("Undo check-in for #22 Zara O'Brien-Khan? They leave the queue and lose their place.");
    expect(api.undoCheckIn).toHaveBeenCalledWith('c22');
  });

  it('finds a registered candidate and checks them in', async () => {
    const api = fakeApi({
      listCandidates: vi.fn(async () => [
        { id: 'c5', number: 5, full_name: 'Hina Tariq', reg_number: '2025005', status: 'registered' as const },
        { id: 'c20', number: 20, full_name: 'Bilal Khan', reg_number: '2025020', status: 'waiting' as const },
      ]),
    });
    await openQueue(api);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search candidates' }), 'hina');
    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(results).toHaveTextContent('2025005 · Not checked in');
    expect(api.listCandidates).toHaveBeenCalledWith('ind-1');

    const loads = vi.mocked(api.boardSnapshot).mock.calls.length;
    await userEvent.click(within(results).getByRole('button', { name: 'Check in #5' }));
    expect(api.checkIn).toHaveBeenCalledWith('c5');
    await waitFor(() => expect(vi.mocked(api.boardSnapshot).mock.calls.length).toBeGreaterThan(loads));

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search candidates' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search candidates' }), '#20');
    expect(await screen.findByText('2025020 · Waiting · pool #1')).toBeInTheDocument();
  });

  it('closes the search results on a click or Tab elsewhere, and brings them back when the box is used again', async () => {
    const api = fakeApi({
      listCandidates: vi.fn(async () => [{ id: 'c5', number: 5, full_name: 'Hina Tariq', reg_number: '2025005', status: 'registered' as const }]),
    });
    await openQueue(api);
    const box = screen.getByRole('searchbox', { name: 'Search candidates' });
    await userEvent.type(box, 'hina');
    await screen.findByRole('list', { name: 'Search results' });

    await userEvent.click(screen.getByRole('region', { name: 'Panel 1' }));
    expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();
    expect(box).toHaveValue('hina');

    await userEvent.click(box);
    expect(await screen.findByRole('list', { name: 'Search results' })).toHaveTextContent('Hina Tariq');
    act(() => screen.getByRole('button', { name: 'Import CSV' }).focus());
    expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();

    await userEvent.type(box, '{Backspace}');
    expect(await screen.findByRole('list', { name: 'Search results' })).toHaveTextContent('Hina Tariq');
    await userEvent.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();
  });

  it("keeps an admin's search results while a candidate's application, or its photo, is open on top", async () => {
    URL.createObjectURL = vi.fn(() => 'blob:1');
    const api = fakeApi({
      listCandidates: vi.fn(async () => [{ id: 'c5', number: 5, full_name: 'Hina Tariq', reg_number: '2025005', status: 'registered' as const }]),
      candidate: vi.fn(async () => candidateRow({ id: 'c5', number: 5, full_name: 'Hina Tariq', photo_taken_at: 'v1' })),
    });
    await openQueue(api, 'admin');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search candidates' }), 'hina');
    const results = await screen.findByRole('list', { name: 'Search results' });
    await userEvent.click(within(results).getByRole('button', { name: '#5 Hina Tariq' }));
    const application = await screen.findByRole('dialog', { name: 'Application of #5 Hina Tariq' });

    await userEvent.click(await within(application).findByRole('button', { name: 'Enlarge photo of Hina Tariq' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Photo of Hina Tariq' })).getByRole('button', { name: 'Close' }));
    await userEvent.click(within(application).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('list', { name: 'Search results' })).toHaveTextContent('Hina Tariq');
  });

  it('reloads when a board event arrives and shows a banner while reconnecting', async () => {
    const api = fakeApi();
    await openQueue(api);
    vi.mocked(api.boardSnapshot).mockResolvedValue(board({ counts: { registered: 39, waiting: 5, interviewing: 1, interviewed: 16 } }));
    act(() => api.topics.board.event());
    expect(await screen.findByLabelText('Candidate counts')).toHaveTextContent('Registered 39');

    act(() => api.topics.board.status('error'));
    expect(screen.getByText(/Reconnecting…/)).toBeInTheDocument();
    act(() => api.topics.board.status('subscribed'));
    expect(screen.queryByText(/Reconnecting…/)).toBeNull();
  });

  it("shows the server's message when an action fails", async () => {
    const api = fakeApi({ sendIn: vi.fn(() => Promise.reject(new ApiError('Panel 2 is busy'))) });
    await openQueue(api);
    await userEvent.click(screen.getByRole('button', { name: 'Send #12 in to Panel 2' }));
    expect(await screen.findByText('Panel 2 is busy')).toBeInTheDocument();
  });

  it('lets an admin add panels', async () => {
    const { api } = await openQueue(fakeApi(), 'admin');
    await userEvent.click(screen.getByRole('button', { name: '+ Add panel' }));
    expect(api.addPanel).toHaveBeenCalled();
  });

  it('gives the queue manager no + Add panel, and opens the CSV import', async () => {
    await openQueue();
    expect(screen.queryByRole('button', { name: '+ Add panel' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(screen.getByRole('dialog', { name: 'Import candidates from CSV' })).toBeInTheDocument();
  });

  it("offers a retry when the board can't be loaded", async () => {
    const api = fakeApi({ boardSnapshot: vi.fn(() => Promise.reject(new ApiError("Can't reach the server. Check the connection and try again."))) });
    renderApp('/queue', { api, auth: queueManager().backend });
    expect(await screen.findByText("Couldn't load the board")).toBeInTheDocument();
    vi.mocked(api.boardSnapshot).mockResolvedValue(board());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Panel 1' })).toBeInTheDocument();
  });

  it('signs out an account that was disabled while the board was open', async () => {
    const { api, auth, router } = await openQueue();
    auth.profiles.delete('u-queue'); // a disabled account can no longer read its profile
    vi.mocked(api.skipCandidate).mockImplementation(async () => {
      notAllowed.emit(); // what createApi does when the server answers "Not allowed"
      throw new ApiError('Not allowed');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Skip #20' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(await screen.findByRole('alert')).toHaveTextContent(DISABLED_NOTICE);
  });
});
