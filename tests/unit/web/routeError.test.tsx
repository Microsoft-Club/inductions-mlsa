// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardSnapshot, DisplaySnapshot } from '../../../src/lib/types.ts';
import { board, display, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

describe('when a screen fails to render', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the projector shows "Connecting…" and tries again, never an error page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...display(), panels: null } as unknown as DisplaySnapshot; // a bug or unexpected data
    renderApp('/display?key=k1', { api: fakeApi({ displaySnapshot: vi.fn(async () => broken) }) });
    expect(await screen.findByTestId('projector-recovering')).toHaveTextContent('Connecting…');
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  });

  it('staff screens say so and offer a reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...board(), panels: null } as unknown as BoardSnapshot;
    renderApp('/queue', {
      api: fakeApi({ boardSnapshot: vi.fn(async () => broken) }),
      auth: fakeAuth({ signedInAs: profile('queue_manager') }).backend,
    });
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  });
});
