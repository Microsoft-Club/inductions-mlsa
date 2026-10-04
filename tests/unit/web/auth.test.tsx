// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, DISABLED_NOTICE, useAuth } from '../../../src/auth/AuthProvider.tsx';
import { loginErrorMessage } from '../../../src/auth/authBackend.ts';
import { NETWORK_ERROR } from '../../../src/lib/api.ts';
import { notAllowed } from '../../../src/lib/notAllowed.ts';
import { profile } from './fixtures.ts';
import { fakeAuth } from './helpers.tsx';

function Status() {
  const { state } = useAuth();
  const text =
    state.status === 'signed_in' ? `in:${state.profile.username}` : state.status === 'signed_out' ? `out:${state.notice ?? ''}` : 'loading';
  return <p data-testid="auth">{text}</p>;
}

function renderAuth(backend: ReturnType<typeof fakeAuth>['backend']) {
  render(
    <AuthProvider backend={backend}>
      <Status />
    </AuthProvider>,
  );
  return () => screen.getByTestId('auth').textContent;
}

describe('AuthProvider', () => {
  it('is signed out without a session', async () => {
    const status = renderAuth(fakeAuth().backend);
    expect(await screen.findByText('out:')).toBeInTheDocument();
    expect(status()).toBe('out:');
  });

  it('restores a session with its profile', async () => {
    renderAuth(fakeAuth({ signedInAs: profile('queue_manager') }).backend);
    expect(await screen.findByText('in:queue')).toBeInTheDocument();
  });

  it('signs out a disabled account and says why', async () => {
    const { backend } = fakeAuth({ signedInAs: profile('panelist', { is_active: false }) });
    renderAuth(backend);
    expect(await screen.findByText(`out:${DISABLED_NOTICE}`)).toBeInTheDocument();
    expect(backend.signOut).toHaveBeenCalled();
  });

  describe('when the page starts while the network is failing', () => {
    afterEach(() => vi.useRealTimers());

    /** A saved session whose profile can't be loaded until `networkBack()`. */
    function flakyStart() {
      const { backend } = fakeAuth({ signedInAs: profile('panelist') });
      let up = false;
      const load = backend.loadProfile;
      backend.loadProfile = async (id) => {
        if (!up) throw new Error('TypeError: Failed to fetch');
        return load(id);
      };
      return { backend, networkBack: () => (up = true) };
    }

    it('keeps trying and signs the person back in by itself once the server answers', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { backend, networkBack } = flakyStart();
      renderAuth(backend);
      expect(await screen.findByText(`out:${NETWORK_ERROR}`)).toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(5_000)); // still failing: no change
      expect(screen.getByTestId('auth').textContent).toBe(`out:${NETWORK_ERROR}`);
      networkBack();
      await act(() => vi.advanceTimersByTimeAsync(15_000));
      expect(screen.getByTestId('auth').textContent).toBe('in:panelist');
    });

    it('tries again as soon as the browser says the network is back', async () => {
      const { backend, networkBack } = flakyStart();
      renderAuth(backend);
      expect(await screen.findByText(`out:${NETWORK_ERROR}`)).toBeInTheDocument();
      networkBack();
      await act(async () => window.dispatchEvent(new Event('online')));
      expect(await screen.findByText('in:panelist')).toBeInTheDocument();
    });
  });

  it('re-checks the account when the server says "Not allowed"', async () => {
    const { backend, profiles } = fakeAuth({ signedInAs: profile('queue_manager') });
    renderAuth(backend);
    await screen.findByText('in:queue');

    profiles.delete('u-queue'); // disabled accounts can no longer read their profile
    await act(async () => notAllowed.emit());
    expect(await screen.findByText(`out:${DISABLED_NOTICE}`)).toBeInTheDocument();
  });
});

describe('loginErrorMessage', () => {
  it('explains the common sign-in failures', () => {
    expect(loginErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('Wrong username or password.');
    expect(loginErrorMessage({ code: 'user_banned', message: 'User is banned' })).toBe('This account is disabled. Ask an admin.');
    expect(loginErrorMessage({ message: 'TypeError: Failed to fetch', status: 0 })).toBe(NETWORK_ERROR);
  });
});
