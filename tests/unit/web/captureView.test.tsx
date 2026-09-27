// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/lib/api.ts';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import { CaptureView } from '../../../src/photos/CaptureView.tsx';
import { shrinkPhoto, UNREADABLE_PHOTO } from '../../../src/photos/shrinkPhoto.ts';
import { clearPhotoCache } from '../../../src/photos/usePhoto.ts';
import { fakeApi } from './helpers.tsx';

vi.mock('../../../src/photos/shrinkPhoto.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/photos/shrinkPhoto.ts')>()),
  shrinkPhoto: vi.fn(async () => new Blob(['small jpeg'], { type: 'image/jpeg' })),
  grabFrame: vi.fn(),
}));

const photoFile = () => new File(['big photo'], 'photo.jpg', { type: 'image/jpeg' });

function renderCapture(api = fakeApi(), currentVersion: string | null = null) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <ApiProvider api={api}>
      <CaptureView candidate={{ id: 'c12', number: 12, name: 'Ali Khan' }} currentVersion={currentVersion} onSaved={onSaved} onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onSaved, onClose, dialog: screen.getByRole('dialog', { name: 'Photo of #12 Ali Khan' }) };
}

function pretendToBeAPhone() {
  window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
}

describe('CaptureView', () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    clearPhotoCache();
    // @ts-expect-error jsdom has no matchMedia; put it back the way it was
    delete window.matchMedia;
  });

  it('on a laptop without a camera, shrinks a chosen file, previews it and saves it', async () => {
    const { api, onSaved } = renderCapture();
    expect(await screen.findByText('No camera available here. Choose a photo file instead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a photo file' })).toBeInTheDocument();

    await userEvent.upload(screen.getByLabelText('Photo file'), photoFile());
    expect(await screen.findByRole('img', { name: 'New photo of Ali Khan' })).toHaveAttribute('src', 'blob:1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(api.uploadPhoto).toHaveBeenCalledWith('c12', expect.any(Blob));
    expect(await (vi.mocked(api.uploadPhoto).mock.calls[0][1] as Blob).text()).toBe('small jpeg');
    expect(onSaved).toHaveBeenCalledWith('2026-09-26T10:05:00Z');
  });

  it('on a phone, one big button opens the back camera', async () => {
    pretendToBeAPhone();
    renderCapture();
    const input = screen.getByLabelText('Photo file');
    expect(input).toHaveAttribute('capture', 'environment');
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(click).toHaveBeenCalled();
    expect(screen.queryByText(/No camera available/)).toBeNull();
  });

  it('keeps the photo after a failed save, and saving again works', async () => {
    const api = fakeApi({
      uploadPhoto: vi.fn().mockRejectedValueOnce(new ApiError('Candidate #12 is not waiting')).mockResolvedValueOnce('2026-09-26T10:06:00Z'),
    });
    const { onSaved } = renderCapture(api);
    await userEvent.upload(screen.getByLabelText('Photo file'), photoFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Candidate #12 is not waiting');
    expect(screen.getByRole('img', { name: 'New photo of Ali Khan' })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('2026-09-26T10:06:00Z'));
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2);
  });

  it('asks for another photo when the browser cannot read one', async () => {
    vi.mocked(shrinkPhoto).mockRejectedValueOnce(new Error(UNREADABLE_PHOTO));
    renderCapture();
    await userEvent.upload(screen.getByLabelText('Photo file'), photoFile());
    expect(await screen.findByRole('alert')).toHaveTextContent(UNREADABLE_PHOTO);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('Retake throws the preview away', async () => {
    renderCapture();
    await userEvent.upload(screen.getByLabelText('Photo file'), photoFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Retake' }));
    expect(screen.queryByRole('img', { name: 'New photo of Ali Khan' })).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(screen.getByRole('button', { name: 'Choose a photo file' })).toBeInTheDocument();
  });

  it('shows the photo on file and offers a retake', async () => {
    pretendToBeAPhone();
    renderCapture(fakeApi(), '2026-09-26T09:30:00Z');
    expect(await screen.findByRole('img', { name: 'Photo of Ali Khan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retake photo' })).toBeInTheDocument();
  });

  it('closes with Close or Escape', async () => {
    const { onClose } = renderCapture();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
