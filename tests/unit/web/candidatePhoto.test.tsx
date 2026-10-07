// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import type { Api } from '../../../src/lib/api.ts';
import { ApplicationDialog } from '../../../src/panel/ApplicationDialog.tsx';
import { CandidatePhoto, initials } from '../../../src/photos/CandidatePhoto.tsx';
import { clearPhotoCache, rememberPhoto } from '../../../src/photos/usePhoto.ts';
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

  it('falls back to the placeholder when a stored file cannot be decoded, never a broken image', async () => {
    const api = fakeApi();
    show(api, { id: 'c12', version: 'v1' });
    const img = await screen.findByRole('img', { name: 'Photo of Ali Khan' });
    fireEvent.error(img);
    expect(await screen.findByRole('img', { name: 'No photo of Ali Khan' })).toHaveTextContent('AK');
  });

  it('gives a broken photo another chance when the candidate or version changes', async () => {
    const api = fakeApi();
    const view = show(api, { id: 'c12', version: 'v1' });
    fireEvent.error(await screen.findByRole('img', { name: 'Photo of Ali Khan' }));
    await screen.findByRole('img', { name: 'No photo of Ali Khan' });

    view.rerender(
      <ApiProvider api={api}>
        <CandidatePhoto candidateId="c12" version="v2" name="Ali Khan" />
      </ApiProvider>,
    );
    expect(await screen.findByRole('img', { name: 'Photo of Ali Khan' })).toBeInTheDocument();
  });

  it('remembers a just-uploaded photo, so it shows without a download', async () => {
    const api = fakeApi();
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    rememberPhoto('c12', 'v1', blob);
    show(api, { id: 'c12', version: 'v1' });
    expect(await screen.findByRole('img', { name: 'Photo of Ali Khan' })).toHaveAttribute('src', 'blob:1');
    expect(api.photoBlob).not.toHaveBeenCalled();

    clearPhotoCache();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1'));
  });

  it('opens the photo full size on a click, and Close, Escape or a click anywhere closes it', async () => {
    const api = fakeApi();
    render(
      <ApiProvider api={api}>
        <CandidatePhoto candidateId="c12" version="v1" name="Ali Khan" expandable />
      </ApiProvider>,
    );
    const thumbnail = await screen.findByRole('button', { name: 'Enlarge photo of Ali Khan' });

    await userEvent.click(thumbnail);
    const viewer = screen.getByRole('dialog', { name: 'Photo of Ali Khan' });
    expect(within(viewer).getByRole('img', { name: 'Photo of Ali Khan' })).toHaveAttribute('src', 'blob:1');
    expect(within(viewer).getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(thumbnail).toHaveFocus();

    await userEvent.click(thumbnail);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(thumbnail);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('img'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.photoBlob).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to enlarge without a photo, or where the photo is not expandable', async () => {
    const api = fakeApi();
    render(
      <ApiProvider api={api}>
        <CandidatePhoto candidateId="c12" version={null} name="Ali Khan" expandable />
        <CandidatePhoto candidateId="c13" version="v1" name="Sara Ahmed" />
      </ApiProvider>,
    );
    await screen.findByRole('img', { name: 'Photo of Sara Ahmed' });
    expect(screen.getByRole('img', { name: 'No photo of Ali Khan' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('closes just the photo on Escape when it was opened from a candidate’s application', async () => {
    const onClose = vi.fn();
    const api = fakeApi({ candidate: vi.fn(async () => candidateRow({ photo_taken_at: 'v1' })) });
    render(
      <ApiProvider api={api}>
        <ApplicationDialog candidateId="c7" onClose={onClose} />
      </ApiProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Enlarge photo of Sara Ahmed' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Photo of Sara Ahmed' })).getByRole('img'));
    expect(screen.getByRole('dialog', { name: 'Application of #7 Sara Ahmed' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Enlarge photo of Sara Ahmed' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Photo of Sara Ahmed' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the full-size photo when the card moves on to another candidate', async () => {
    const api = fakeApi();
    const view = render(
      <ApiProvider api={api}>
        <CandidatePhoto candidateId="c12" version="v1" name="Ali Khan" expandable />
      </ApiProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Enlarge photo of Ali Khan' }));
    view.rerender(
      <ApiProvider api={api}>
        <CandidatePhoto candidateId="c13" version="v1" name="Sara Ahmed" expandable />
      </ApiProvider>,
    );
    await screen.findByRole('button', { name: 'Enlarge photo of Sara Ahmed' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
