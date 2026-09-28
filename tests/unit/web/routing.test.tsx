// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { profile } from './fixtures.ts';
import { fakeAuth, renderApp } from './helpers.tsx';

const accounts = {
  queue: { password: 'right-password', profile: profile('queue_manager') },
  panelist: { password: 'right-password', profile: profile('panelist') },
  photos: { password: 'right-password', profile: profile('photographer') },
};

async function signIn(username: string, password = 'right-password') {
  await userEvent.type(await screen.findByLabelText('Username'), username);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign in and routing', () => {
  it('sends a signed-out visitor to the login page and back after signing in', async () => {
    const { router } = renderApp('/queue', { auth: fakeAuth({ accounts }).backend });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fqueue');

    await signIn('queue');
    await waitFor(() => expect(router.state.location.pathname).toBe('/queue'));
  });

  it('shows why a sign-in failed', async () => {
    renderApp('/login', { auth: fakeAuth({ accounts }).backend });
    await signIn('queue', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
  });

  it("sends each role to its own screen and ignores off-site ?next= targets", async () => {
    const { router } = renderApp('/login?next=//evil.example', { auth: fakeAuth({ accounts }).backend });
    await signIn('panelist');
    await waitFor(() => expect(router.state.location.pathname).toBe('/panel'));
  });

  it("keeps a role out of another role's screen", async () => {
    renderApp('/queue', { auth: fakeAuth({ signedInAs: profile('panelist') }).backend });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });

  it('lets an admin open every screen and sign out', async () => {
    const { router } = renderApp('/', { auth: fakeAuth({ signedInAs: profile('admin') }).backend });
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    const nav = screen.getByRole('navigation', { name: 'Screens' });
    expect(nav).toHaveTextContent('QueuePanelPhotosResultsAdmin');
    expect(await screen.findByText('http://localhost:3000/display?key=test-key')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(''); // the next person to sign in starts on their own screen
  });

  it('sends a photographer to /photos and keeps them off the queue', async () => {
    const { router } = renderApp('/login', { auth: fakeAuth({ accounts }).backend });
    await signIn('photos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/photos'));
    await router.navigate('/queue');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
});
