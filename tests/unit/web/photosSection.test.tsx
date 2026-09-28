// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import { profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

async function openAdmin(api: Api) {
  renderApp('/admin', { api, auth: fakeAuth({ signedInAs: profile('admin') }).backend });
  return screen.findByRole('region', { name: 'Photos' });
}

describe('Photos on the admin page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deletes every photo after asking, then shows none left', async () => {
    const api = fakeApi({ photoCount: vi.fn().mockResolvedValueOnce(3).mockResolvedValue(0), deleteAllPhotos: vi.fn(async () => 3) });
    const section = await openAdmin(api);
    expect(await within(section).findByText(/3 photos stored\./)).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete all photos' }));
    expect(confirm).toHaveBeenLastCalledWith("Delete all 3 photos? This can't be undone.");
    expect(api.deleteAllPhotos).not.toHaveBeenCalled();

    await userEvent.click(within(section).getByRole('button', { name: 'Delete all photos' }));
    expect(api.deleteAllPhotos).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Deleted 3 photos.')).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByText(/0 photos stored\./)).toBeInTheDocument());
    // A known race can leave photo files in R2 with no records (count 0); the remedy is to press again.
    expect(within(section).getByRole('button', { name: 'Delete all photos' })).toBeEnabled();
  });

  it('says one photo, not one photos', async () => {
    const section = await openAdmin(fakeApi({ photoCount: vi.fn(async () => 1) }));
    expect(await within(section).findByText(/1 photo stored\./)).toBeInTheDocument();
  });

  it('at zero, still asks, but about leftover files rather than a count', async () => {
    const section = await openAdmin(fakeApi({ photoCount: vi.fn(async () => 0) }));
    expect(await within(section).findByText(/0 photos stored\./)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Delete all photos' })).toBeEnabled();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete all photos' }));
    expect(confirm).toHaveBeenLastCalledWith("Remove any leftover photo files? This can't be undone.");
  });

  it('offers the Photographer role for new accounts', async () => {
    await openAdmin(fakeApi());
    const role = screen.getByRole('combobox', { name: 'Role' });
    expect(within(role).getByRole('option', { name: 'Photographer' })).toBeInTheDocument();
  });
});
