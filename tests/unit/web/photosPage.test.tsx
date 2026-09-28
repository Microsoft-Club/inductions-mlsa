// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import { clearPhotoCache } from '../../../src/photos/usePhoto.ts';
import { photoEntry, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

vi.mock('../../../src/photos/shrinkPhoto.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/photos/shrinkPhoto.ts')>()),
  shrinkPhoto: vi.fn(async () => new Blob(['small jpeg'], { type: 'image/jpeg' })),
}));

const waiting = [
  photoEntry(13, 'Hina Malik', { checked_in_at: '2026-09-26T09:05:00Z' }),
  photoEntry(12, 'Ali Khan', { checked_in_at: '2026-09-26T09:00:00Z' }),
  photoEntry(20, 'Bilal Raza', { photo_taken_at: '2026-09-26T09:10:00Z' }),
];

async function openPhotos(api: Api = fakeApi({ photoQueue: vi.fn(async () => waiting) })) {
  const view = renderApp('/photos', { api, auth: fakeAuth({ signedInAs: profile('photographer') }).backend });
  await screen.findByRole('heading', { name: 'Photos', level: 1 });
  return { ...view, api };
}

describe('PhotosPage', () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => clearPhotoCache());

  it('lists who needs a photo and who is done, with the counts', async () => {
    await openPhotos();
    expect(screen.getByText('2 need photo · 1 done')).toBeInTheDocument();
    const needs = screen.getByRole('list', { name: 'Needs photo' });
    expect(within(needs).getAllByRole('button').map((b) => b.textContent)).toEqual(['#12 Ali Khan', '#13 Hina Malik']);
    const done = screen.getByRole('list', { name: 'Done' });
    expect(within(done).getByRole('button', { name: /#20 Bilal Raza/ })).toBeInTheDocument();
    expect(document.title).toBe('Photos · MLSA Induction');
    expect(screen.queryByRole('navigation', { name: 'Screens' })).toBeNull(); // one screen, no links
  });

  it('finds people by number or name', async () => {
    await openPhotos();
    const search = screen.getByRole('searchbox', { name: 'Find a candidate' });
    await userEvent.type(search, '13');
    expect(within(screen.getByRole('list', { name: 'Needs photo' })).getAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByText('Nobody here matches.')).toHaveLength(1); // Done
    await userEvent.clear(search);
    await userEvent.type(search, 'bil');
    expect(screen.getByText('Nobody here matches.')).toBeInTheDocument(); // Needs photo
    expect(within(screen.getByRole('list', { name: 'Done' })).getByRole('button', { name: /Bilal Raza/ })).toBeInTheDocument();
  });

  it('reloads when the board changes (someone checked in or sent in)', async () => {
    const { api } = await openPhotos();
    const before = vi.mocked(api.photoQueue).mock.calls.length;
    (api as ReturnType<typeof fakeApi>).topics.board.event();
    await waitFor(() => expect(vi.mocked(api.photoQueue).mock.calls.length).toBeGreaterThan(before));
  });

  it('opens the capture view for the person tapped, and reloads after saving', async () => {
    const { api } = await openPhotos();
    await userEvent.click(within(screen.getByRole('list', { name: 'Needs photo' })).getByRole('button', { name: '#12 Ali Khan' }));
    const dialog = screen.getByRole('dialog', { name: 'Photo of #12 Ali Khan' });
    const before = vi.mocked(api.photoQueue).mock.calls.length;
    await userEvent.upload(within(dialog).getByLabelText('Photo file'), new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Save' }));
    expect(api.uploadPhoto).toHaveBeenCalledWith('c12', expect.any(Blob));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(vi.mocked(api.photoQueue).mock.calls.length).toBeGreaterThan(before));
  });

  it('says so when nobody is waiting', async () => {
    await openPhotos(fakeApi({ photoQueue: vi.fn(async () => []) }));
    expect(screen.getByText('0 need photo · 0 done')).toBeInTheDocument();
    expect(screen.getByText('Nobody is waiting.')).toBeInTheDocument();
    expect(screen.getByText('No photos yet.')).toBeInTheDocument();
  });

  it('says so when everyone waiting has a photo', async () => {
    await openPhotos(fakeApi({ photoQueue: vi.fn(async () => [photoEntry(20, 'Bilal Raza', { photo_taken_at: '2026-09-26T09:10:00Z' })]) }));
    expect(screen.getByText('Everyone waiting has a photo.')).toBeInTheDocument();
  });

  it('keeps other roles out', async () => {
    renderApp('/photos', { auth: fakeAuth({ signedInAs: profile('queue_manager') }).backend });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
});
