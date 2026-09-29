// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FormWarning } from '../../../src/lib/types.ts';
import { board } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

const queueManager = () =>
  fakeAuth({ signedInAs: { id: 'u-queue', username: 'queue', display_name: 'Queue', role: 'queue_manager', is_active: true, current_panel_id: null } });

const WARNINGS: FormWarning[] = [
  {
    id: 'w2',
    reg_number: '2025099',
    name: 'Ayesha K',
    reason: 'Possible reg number typo; email matches #1',
    created_at: '2026-09-26T09:58:00Z',
  },
  {
    id: 'w1',
    reg_number: '',
    name: '',
    reason: "A form response was not imported: the form's questions no longer match the app (column 9 is now \"Why us?\").",
    created_at: '2026-09-26T09:40:00Z',
  },
];

async function openQueue(warnings: FormWarning[]) {
  const api = fakeApi({ boardSnapshot: vi.fn(async () => board({ form_warnings: warnings })) });
  renderApp('/queue', { api, auth: queueManager().backend });
  await screen.findByRole('region', { name: 'Panel 1' });
  return api;
}

describe('Google Form warnings on the queue board', () => {
  it('lists each warning with who it is about and why', async () => {
    await openQueue(WARNINGS);
    const section = screen.getByRole('region', { name: 'Google Form warnings' });
    expect(within(section).getByRole('heading')).toHaveTextContent('Google Form sync needs a closer look (2)');
    const [typo, problem] = within(section).getAllByRole('listitem');
    expect(typo).toHaveTextContent('2025099');
    expect(typo).toHaveTextContent('Ayesha K');
    expect(typo).toHaveTextContent('Possible reg number typo; email matches #1');
    expect(within(typo).getByRole('time')).toHaveAttribute('dateTime', '2026-09-26T09:58:00Z');
    expect(problem).toHaveTextContent('column 9 is now "Why us?"');
  });

  it('dismisses one warning at a time and reloads the board', async () => {
    const api = await openQueue(WARNINGS);
    const section = screen.getByRole('region', { name: 'Google Form warnings' });
    const loads = vi.mocked(api.boardSnapshot).mock.calls.length;
    await userEvent.click(within(section).getByRole('button', { name: 'Dismiss the warning about 2025099 Ayesha K' }));
    expect(api.dismissFormWarning).toHaveBeenCalledExactlyOnceWith('w2');
    await waitFor(() => expect(vi.mocked(api.boardSnapshot).mock.calls.length).toBeGreaterThan(loads));

    await userEvent.click(within(section).getByRole('button', { name: 'Dismiss the warning about the form' }));
    expect(api.dismissFormWarning).toHaveBeenLastCalledWith('w1');
  });

  it('shows nothing when there are no warnings', async () => {
    await openQueue([]);
    expect(screen.queryByRole('region', { name: 'Google Form warnings' })).not.toBeInTheDocument();
  });
});
