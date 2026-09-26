// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import { generatePassword } from '../../../src/admin/password.ts';
import { profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

// Real accounts have UUID ids, and the admin-users checks insist on them.
const ids = {
  admin: '6f1c2d3e-0000-4000-8000-000000000001',
  queue: '6f1c2d3e-0000-4000-8000-000000000002',
  mariam: '6f1c2d3e-0000-4000-8000-000000000003',
};
const me = profile('admin', { id: ids.admin });
const accounts = [
  me,
  profile('queue_manager', { id: ids.queue, display_name: 'Queue Desk' }),
  profile('panelist', { id: ids.mariam, username: 'panelist2', display_name: 'Mariam', is_active: false }),
];

async function openAdmin(overrides: Partial<Api> = {}) {
  const api = fakeApi({ listAccounts: vi.fn(async () => accounts), ...overrides });
  const view = renderApp('/admin', { api, auth: fakeAuth({ signedInAs: me }).backend });
  await screen.findByRole('region', { name: 'Accounts' });
  return { ...view, api };
}

/** The accounts table row for a person (their name also appears in the page header, so look inside Accounts). */
const row = async (name: string) => (await within(screen.getByRole('region', { name: 'Accounts' })).findByRole('cell', { name })).closest('tr')!;

describe('generatePassword', () => {
  it('makes 12 easy-to-read characters', () => {
    const password = generatePassword();
    expect(password).toMatch(/^[a-hjkmnp-z2-9]{12}$/);
    expect(generatePassword()).not.toBe(password);
  });
});

describe('the admin page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists accounts with their role and status, and never offers to disable your own', async () => {
    await openAdmin();
    expect(await row('Queue Desk')).toHaveTextContent('queueQueue managerActive');
    const mariam = await row('Mariam');
    expect(mariam).toHaveTextContent('Disabled');
    expect(within(mariam).getByRole('button', { name: 'Enable Mariam' })).toBeInTheDocument();
    const mine = await row('Test admin');
    expect(within(mine).queryByRole('button', { name: /^Disable/ })).toBeNull();
  });

  it('checks a new account before creating it', async () => {
    const { api } = await openAdmin();
    const form = screen.getByRole('form', { name: 'New account' });
    await userEvent.type(within(form).getByLabelText('Username'), 'Hina T');
    await userEvent.type(within(form).getByLabelText('Name'), 'Hina Tariq');
    await userEvent.type(within(form).getByLabelText('Password'), 'long-password');
    await userEvent.click(within(form).getByRole('button', { name: 'Create account' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Username must be 3 to 32 characters: lowercase letters, digits or _');
    expect(api.manageAccount).not.toHaveBeenCalled();

    await userEvent.clear(within(form).getByLabelText('Username'));
    await userEvent.type(within(form).getByLabelText('Username'), 'hina_t');
    await userEvent.click(within(form).getByRole('button', { name: 'Create account' }));
    expect(api.manageAccount).toHaveBeenCalledWith({ action: 'create', username: 'hina_t', displayName: 'Hina Tariq', role: 'panelist', password: 'long-password' });
    expect(await screen.findByText('Account created for Hina Tariq. Give them the username and password.')).toBeInTheDocument();
    await waitFor(() => expect(api.listAccounts).toHaveBeenCalledTimes(2));
    expect(within(form).getByLabelText('Username')).toHaveValue('');
  });

  it('fills in a generated password', async () => {
    await openAdmin();
    const form = screen.getByRole('form', { name: 'New account' });
    await userEvent.click(within(form).getByRole('button', { name: 'Generate' }));
    expect((within(form).getByLabelText('Password') as HTMLInputElement).value).toMatch(/^[a-z2-9]{12}$/);
  });

  it('resets a password', async () => {
    const { api } = await openAdmin();
    const queue = await row('Queue Desk');
    await userEvent.click(within(queue).getByRole('button', { name: 'Reset password for Queue Desk' }));
    await userEvent.type(within(queue).getByLabelText('New password for Queue Desk'), 'fresh-password');
    await userEvent.click(within(queue).getByRole('button', { name: 'Save' }));
    expect(api.manageAccount).toHaveBeenCalledWith({ action: 'reset_password', userId: ids.queue, password: 'fresh-password' });
    expect(await screen.findByText('Password reset for Queue Desk')).toBeInTheDocument();
  });

  it('disables an account after confirming, and enables one straight away', async () => {
    const { api } = await openAdmin();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(within(await row('Queue Desk')).getByRole('button', { name: 'Disable Queue Desk' }));
    expect(window.confirm).toHaveBeenCalledWith("Disable Queue Desk? They are signed out and can't sign in until an admin enables the account again.");
    expect(api.manageAccount).toHaveBeenCalledWith({ action: 'set_active', userId: ids.queue, active: false });
    await userEvent.click(within(await row('Mariam')).getByRole('button', { name: 'Enable Mariam' }));
    expect(api.manageAccount).toHaveBeenLastCalledWith({ action: 'set_active', userId: ids.mariam, active: true });
  });

  it('saves the induction settings after checking them', async () => {
    const { api } = await openAdmin();
    const settings = screen.getByRole('region', { name: 'Settings' });
    const name = await within(settings).findByDisplayValue('Fall 2026');
    const minutes = within(settings).getByLabelText('Target interview length (minutes)');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '0');
    await userEvent.click(within(settings).getByRole('button', { name: 'Save settings' }));
    expect(within(settings).getByRole('alert')).toHaveTextContent('Target interview length must be 1 to 180 minutes');
    expect(api.updateSettings).not.toHaveBeenCalled();

    await userEvent.clear(name);
    await userEvent.type(name, 'Fall 2026 Inductions');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '20');
    await userEvent.click(within(settings).getByRole('button', { name: 'Save settings' }));
    expect(api.updateSettings).toHaveBeenCalledWith('Fall 2026 Inductions', 20);
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
  });

  it('makes a new projector link after confirming', async () => {
    const { api } = await openAdmin();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(await screen.findByText('http://localhost:3000/display?key=test-key')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(window.confirm).toHaveBeenCalledWith('Make a new projector link? The current link stops working at once; open the new one on the projector.');
    expect(api.regenerateDisplayKey).toHaveBeenCalled();
    expect(await screen.findByText('http://localhost:3000/display?key=new-key')).toBeInTheDocument();
  });

  it('adds panels and deletes any panel after confirming', async () => {
    const { api } = await openAdmin();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const panels = screen.getByRole('region', { name: 'Panels' });
    await userEvent.click(await within(panels).findByRole('button', { name: '+ Add panel' }));
    expect(api.addPanel).toHaveBeenCalled();
    await userEvent.click(within(panels).getByRole('button', { name: 'Delete Panel 2' }));
    expect(api.deletePanel).toHaveBeenCalledWith('p2');
  });
});
