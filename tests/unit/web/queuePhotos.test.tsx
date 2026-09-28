// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaneEntry } from '../../../src/lib/types.ts';
import { board, boardPanel, lane } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

vi.mock('../../../src/photos/shrinkPhoto.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/photos/shrinkPhoto.ts')>()),
  shrinkPhoto: vi.fn(async () => new Blob(['small jpeg'], { type: 'image/jpeg' })),
}));

const queueManager = () =>
  fakeAuth({ signedInAs: { id: 'u-queue', username: 'queue', display_name: 'Queue', role: 'queue_manager', is_active: true, current_panel_id: null } });

const withoutPhoto = (entries: LaneEntry[], ...numbers: number[]) =>
  entries.map((e) => (numbers.includes(e.number) ? { ...e, has_photo: false } : e));

/** Panel 2 is free; #20 in the pool has no photo, #21 has one. */
async function openQueue(snapshot = board({ pool: withoutPhoto(lane([20, 'Bilal Khan'], [21, 'Hina Malik']), 20) })) {
  const api = fakeApi({ boardSnapshot: vi.fn(async () => snapshot) });
  renderApp('/queue', { api, auth: queueManager().backend });
  const pool = await screen.findByRole('list', { name: 'Waiting pool' });
  const [first, second] = within(pool).getAllByRole('listitem');
  return { api, first, second };
}

describe('photos on the queue board', () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = vi.fn();
  });

  it('marks who has no photo yet', async () => {
    const { first, second } = await openQueue();
    expect(within(first).getByRole('button', { name: 'Take a photo of #20' })).toBeInTheDocument();
    expect(within(second).queryByRole('button', { name: /Take a photo/ })).toBeNull();
  });

  it('asks before sending in someone without a photo, and can send them anyway', async () => {
    const { api, first } = await openQueue();
    await userEvent.click(within(first).getByRole('button', { name: 'Send in → Panel 2' }));
    const question = screen.getByRole('alertdialog', { name: 'No photo yet' });
    expect(question).toHaveTextContent('#20 Bilal Khan has no photo yet.');
    expect(api.sendIn).not.toHaveBeenCalled();

    await userEvent.click(within(question).getByRole('button', { name: 'Send without photo' }));
    expect(api.sendIn).toHaveBeenCalledWith('c20', 'p2');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Cancel sends nobody in', async () => {
    const { api, first } = await openQueue();
    await userEvent.click(within(first).getByRole('button', { name: 'Send in → Panel 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.sendIn).not.toHaveBeenCalled();
  });

  it('Take photo saves the photo, then carries on with the send-in', async () => {
    const { api, first } = await openQueue();
    await userEvent.click(within(first).getByRole('button', { name: 'Send in → Panel 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    const capture = screen.getByRole('dialog', { name: 'Photo of #20 Bilal Khan' });
    await userEvent.upload(within(capture).getByLabelText('Photo file'), new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    await userEvent.click(await within(capture).findByRole('button', { name: 'Save' }));

    expect(api.uploadPhoto).toHaveBeenCalledWith('c20', expect.any(Blob));
    await waitFor(() => expect(api.sendIn).toHaveBeenCalledWith('c20', 'p2'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends someone with a photo straight in', async () => {
    const { api, second } = await openQueue();
    await userEvent.click(within(second).getByRole('button', { name: 'Send in → Panel 2' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.sendIn).toHaveBeenCalledWith('c21', 'p2');
  });

  it("asks for the first in a panel's line too", async () => {
    const snapshot = board({ panels: [boardPanel('p2', 'Panel 2', { is_default: true, lane: withoutPhoto(lane([12, 'Ali Raza']), 12) })], pool: [] });
    renderApp('/queue', { api: fakeApi({ boardSnapshot: vi.fn(async () => snapshot) }), auth: queueManager().backend });
    const card = await screen.findByRole('region', { name: 'Panel 2' });
    expect(within(card).getByRole('button', { name: 'Take a photo of #12' })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Send #12 in to Panel 2' }));
    expect(screen.getByRole('alertdialog', { name: 'No photo yet' })).toHaveTextContent('#12 Ali Raza has no photo yet.');
  });

  it('the camera button takes a photo without sending anyone in', async () => {
    const { api, first } = await openQueue();
    await userEvent.click(within(first).getByRole('button', { name: 'Take a photo of #20' }));
    const capture = screen.getByRole('dialog', { name: 'Photo of #20 Bilal Khan' });
    await userEvent.upload(within(capture).getByLabelText('Photo file'), new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    await userEvent.click(await within(capture).findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalledWith('c20', expect.any(Blob)));
    expect(api.sendIn).not.toHaveBeenCalled();
  });
});
