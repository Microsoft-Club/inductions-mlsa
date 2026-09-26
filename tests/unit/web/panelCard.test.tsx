// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionProvider } from '../../../src/components/ActionProvider.tsx';
import { ToastProvider } from '../../../src/components/Toasts.tsx';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import { ClockProvider } from '../../../src/lib/ClockProvider.tsx';
import type { BoardPanel, Role } from '../../../src/lib/types.ts';
import { PanelCard } from '../../../src/queue/PanelCard.tsx';
import { boardPanel, interview, lane } from './fixtures.ts';
import { fakeApi } from './helpers.tsx';

function renderCard(panel: BoardPanel, role: Role = 'queue_manager') {
  const api = fakeApi();
  render(
    <ApiProvider api={api}>
      <ToastProvider>
        <ClockProvider serverNow={api.serverNow}>
          <ActionProvider>
            <PanelCard panel={panel} targetMinutes={15} role={role} />
          </ActionProvider>
        </ClockProvider>
      </ToastProvider>
    </ApiProvider>,
  );
  return { api, card: screen.getByRole('region', { name: panel.name }) };
}

describe('PanelCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers Send in for the first person lined up while the panel is free', async () => {
    const { api, card } = renderCard(boardPanel('p2', 'Panel 2', { lane: lane([12, 'Ali Raza'], [13, 'Hina']) }));
    expect(within(card).getByText('Free')).toBeInTheDocument();
    expect(within(card).getAllByRole('button', { name: /^Send #\d+ in/ })).toHaveLength(1);

    await userEvent.click(within(card).getByRole('button', { name: 'Send #12 in to Panel 2' }));
    expect(api.sendIn).toHaveBeenCalledWith('c12', 'p2');
  });

  it('shows the interview in progress with end and undo, and no Send in', async () => {
    const { api, card } = renderCard(
      boardPanel('p1', 'Panel 1', {
        current: interview(7, 'Sara Ahmed'),
        lane: lane([12, 'Ali Raza']),
        panelists: [{ id: 'u1', display_name: 'Hamza' }],
      }),
    );
    expect(within(card).getByText('Busy')).toBeInTheDocument();
    expect(within(card).getByText('Sara Ahmed')).toBeInTheDocument();
    expect(within(card).getByText('Present: Hamza')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Send #/ })).toBeNull();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(within(card).getByRole('button', { name: 'End interview' }));
    expect(confirm).toHaveBeenCalledWith('End the interview with #7 Sara Ahmed in Panel 1?');
    expect(api.endInterview).not.toHaveBeenCalled(); // cancelled
    await userEvent.click(within(card).getByRole('button', { name: 'End interview' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Undo send-in' }));
    expect(api.endInterview).toHaveBeenCalledWith('i7');
    expect(api.undoSendIn).toHaveBeenCalledWith('i7');
  });

  it('offers Reopen for the last interview while the panel is free', async () => {
    const { api, card } = renderCard(
      boardPanel('p1', 'Panel 1', {
        last_ended: { interview_id: 'i6', candidate_id: 'c6', number: 6, name: 'Omar', ended_at: '2026-09-26T09:40:00Z' },
      }),
    );
    await userEvent.click(within(card).getByRole('button', { name: 'Reopen the interview with #6' }));
    expect(api.reopenInterview).toHaveBeenCalledWith('i6');
  });

  it('moves people within the lane, skips them, and sends them back to the top of the pool', async () => {
    const { api, card } = renderCard(boardPanel('p2', 'Panel 2', { lane: lane([12, 'Ali Raza'], [13, 'Hina']) }));
    expect(within(card).getByRole('button', { name: 'Move #12 up' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Move #13 down' })).toBeDisabled();

    await userEvent.click(within(card).getByRole('button', { name: 'Move #13 up' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Move #13 to the top' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Skip #12' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Move #12 back to the pool' }));
    expect(vi.mocked(api.moveCandidate).mock.calls).toEqual([
      ['c13', 'p2', 1],
      ['c13', 'p2', 1],
      ['c12', null, 1],
    ]);
    expect(api.skipCandidate).toHaveBeenCalledWith('c12');
  });

  it('lets the queue manager remove only extra panels, after confirming', async () => {
    renderCard(boardPanel('p1', 'Panel 1', { is_default: true }));
    expect(screen.queryByRole('button', { name: 'Delete panel' })).toBeNull();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api, card } = renderCard(boardPanel('p3', 'Panel 3'));
    await userEvent.click(within(card).getByRole('button', { name: 'Delete panel' }));
    expect(window.confirm).toHaveBeenCalledWith('Delete Panel 3? Anyone lined up for it moves to the end of the pool.');
    expect(api.deletePanel).toHaveBeenCalledWith('p3');
  });

  it('lets an admin remove a default panel', () => {
    const { card } = renderCard(boardPanel('p1', 'Panel 1', { is_default: true }), 'admin');
    expect(within(card).getByRole('button', { name: 'Delete panel' })).toBeInTheDocument();
  });
});
