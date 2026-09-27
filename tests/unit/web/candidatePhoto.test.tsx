// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import type { Api } from '../../../src/lib/api.ts';
import { CandidatePhoto, initials } from '../../../src/photos/CandidatePhoto.tsx';
import { clearPhotoCache } from '../../../src/photos/usePhoto.ts';
import { candidateRecordFor, candidateRow, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

function show(api: Api, ...photos: Array<{ id: string; version: string | null }>) {
  return render(
    <ApiProvider api={api}>
      {photos.map((p, i) => (
        <CandidatePhoto key={i} candidateId={p.id} version={p.version} name="Ali Khan" />
      ))}
    </ApiProvider>,
  );
}

describe('CandidatePhoto', () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => clearPhotoCache());

  it('shows initials and downloads nothing when there is no photo', () => {
    const api = fakeApi();
    show(api, { id: 'c12', version: null });
    expect(screen.getByRole('img', { name: 'No photo of Ali Khan' })).toHaveTextContent('AK');
    expect(api.photoBlob).not.toHaveBeenCalled();
  });

  it('downloads the photo once, however many places show it', async () => {
    const api = fakeApi();
    show(api, { id: 'c12', version: 'v1' }, { id: 'c12', version: 'v1' });
    expect(screen.getAllByRole('img', { name: 'Loading photo of Ali Khan' })).toHaveLength(2);
    const images = await screen.findAllByRole('img', { name: 'Photo of Ali Khan' });
    expect(images.map((img) => img.getAttribute('src'))).toEqual(['blob:1', 'blob:1']);
    expect(api.photoBlob).toHaveBeenCalledTimes(1);
    expect(api.photoBlob).toHaveBeenCalledWith('c12', 'v1');
  });

  it('downloads a retake and keeps the old photo for anyone still showing it', async () => {
    const api = fakeApi();
    const view = show(api, { id: 'c12', version: 'v1' });
    await screen.findByRole('img', { name: 'Photo of Ali Khan' });
    view.rerender(
      <ApiProvider api={api}>
        <CandidatePhoto candidateId="c12" version="v2" name="Ali Khan" />
      </ApiProvider>,
    );
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photo of Ali Khan' })).toHaveAttribute('src', 'blob:2'));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('shows two live views of the same candidate at different versions, neither breaking the other', async () => {
    const api = fakeApi();
    show(api, { id: 'c12', version: 'v1' }, { id: 'c12', version: 'v2' });
    const images = await screen.findAllByRole('img', { name: 'Photo of Ali Khan' });
    expect(images.map((img) => img.getAttribute('src')).sort()).toEqual(['blob:1', 'blob:2']);
    expect(api.photoBlob).toHaveBeenCalledTimes(2);
    expect(api.photoBlob).toHaveBeenCalledWith('c12', 'v1');
    expect(api.photoBlob).toHaveBeenCalledWith('c12', 'v2');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('shows the placeholder when the photo is missing', async () => {
    const api = fakeApi({ photoBlob: vi.fn(async () => null) });
    show(api, { id: 'c12', version: 'v1' });
    expect(await screen.findByRole('img', { name: 'No photo of Ali Khan' })).toBeInTheDocument();
  });

  it('makes initials from the first two words', () => {
    expect(initials('  ali   raza khan ')).toBe('AR');
    expect(initials('عائشہ خان')).toBe('عخ');
  });

  it('frees every photo when the user signs out', async () => {
    const api = fakeApi({ candidateRecord: vi.fn(async () => candidateRecordFor(candidateRow({ photo_taken_at: 'v1' }))) });
    renderApp('/results/c7', { api, auth: fakeAuth({ signedInAs: profile('admin') }).backend });
    expect(await screen.findByRole('img', { name: 'Photo of Sara Ahmed' })).toHaveAttribute('src', 'blob:1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1'));
  });
});
