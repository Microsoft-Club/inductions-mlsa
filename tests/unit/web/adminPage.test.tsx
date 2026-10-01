// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../../../src/lib/api.ts';
import { generatePassword } from '../../../src/admin/password.ts';
import { board, boardPanel, interview, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

// Real accounts have UUID ids, and the admin-users checks insist on them.
const ids = {
  admin: '6f1c2d3e-0000-4000-8000-000000000001',
  queue: '6f1c2d3e-0000-4000-8000-000000000002',
  mariam: '6f1c2d3e-0000-4000-8000-000000000003',
  owner: '6f1c2d3e-0000-4000-8000-000000000004',
};
const me = profile('admin', { id: ids.admin });
const owner = profile('admin', { id: ids.owner, username: 'adminmlsa', display_name: 'Owner' });
const accounts = [
  me,
  profile('queue_manager', { id: ids.queue, display_name: 'Queue Desk' }),
  profile('panelist', { id: ids.mariam, username: 'panelist2', display_name: 'Mariam', is_active: false }),
  owner,
];

async function openAdmin(overrides: Partial<Api> = {}, signedInAs = me) {
  const api = fakeApi({ listAccounts: vi.fn(async () => accounts), ...overrides });
  const view = renderApp('/admin', { api, auth: fakeAuth({ signedInAs }).backend });
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
    expect(within(mine).queryByRole('button', { name: /^Change role/ })).toBeNull();
    expect(within(mine).queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it("shows the owner's account as protected, with nothing another admin can change", async () => {
    await openAdmin();
    const ownerRow = await row('Owner');
    expect(ownerRow).toHaveTextContent('Protected');
    expect(within(ownerRow).queryAllByRole('button')).toHaveLength(0);
  });

  it('lets the owner reset their own password', async () => {
    await openAdmin({}, owner);
    const ownerRow = await row('Owner');
    expect(within(ownerRow).getByRole('button', { name: 'Reset password for Owner' })).toBeInTheDocument();
    expect(within(ownerRow).queryByRole('button', { name: /^(Change role|Disable|Delete)/ })).toBeNull();
    expect(ownerRow).not.toHaveTextContent('Protected');
  });

  it("changes someone's role", async () => {
    const { api } = await openAdmin();
    const queue = await row('Queue Desk');
    await userEvent.click(within(queue).getByRole('button', { name: 'Change role for Queue Desk' }));
    const select = within(queue).getByRole('combobox', { name: 'New role for Queue Desk' });
    expect(select).toHaveValue('queue_manager');
    expect(within(queue).getByRole('button', { name: 'Save' })).toBeDisabled(); // nothing changed yet
    await userEvent.selectOptions(select, 'photographer');
    await userEvent.click(within(queue).getByRole('button', { name: 'Save' }));
    expect(api.manageAccount).toHaveBeenCalledWith({ action: 'set_role', userId: ids.queue, role: 'photographer' });
    expect(await screen.findByText("Queue Desk's role is now Photographer")).toBeInTheDocument();
    await waitFor(() => expect(api.listAccounts).toHaveBeenCalledTimes(2));
  });

  it('deletes an account only after confirming', async () => {
    const { api } = await openAdmin();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const deleteQueue = within(await row('Queue Desk')).getByRole('button', { name: 'Delete Queue Desk' });
    await userEvent.click(deleteQueue);
    expect(confirm).toHaveBeenCalledWith("Delete Queue Desk (queue)? This can't be undone.");
    expect(api.manageAccount).not.toHaveBeenCalled();

    await userEvent.click(deleteQueue);
    expect(api.manageAccount).toHaveBeenCalledWith({ action: 'delete', userId: ids.queue });
    expect(await screen.findByText('Deleted the account for Queue Desk')).toBeInTheDocument();
    await waitFor(() => expect(api.listAccounts).toHaveBeenCalledTimes(2));
  });

  it("shows the server's reason when an account can't be deleted", async () => {
    const reason = "Mariam has 2 evaluations, so the account can't be deleted. Disable it instead.";
    await openAdmin({ manageAccount: vi.fn(async () => Promise.reject(new ApiError(reason))) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(within(await row('Mariam')).getByRole('button', { name: 'Delete Mariam' }));
    expect(await screen.findByText(reason)).toBeInTheDocument();
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

  it('shows who is sitting in each panel and removes someone, asking first while an interview is on', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api } = await openAdmin({
      boardSnapshot: vi.fn(async () =>
        board({
          panels: [
            boardPanel('p1', 'Panel 1', { is_default: true, current: interview(7, 'Sara Ahmed'), panelists: [{ id: 'u1', display_name: 'Hamza' }, { id: 'u2', display_name: 'Mariam' }] }),
            boardPanel('p2', 'Panel 2', { is_default: true, panelists: [{ id: 'u3', display_name: 'Omar' }] }),
          ],
        }),
      ),
    });
    const panels = screen.getByRole('region', { name: 'Panels' });
    const panel1 = await within(panels).findByRole('list', { name: 'In Panel 1' });
    expect(within(panel1).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['HamzaRemove', 'MariamRemove']);

    await userEvent.click(within(panel1).getByRole('button', { name: 'Remove Hamza from Panel 1' }));
    expect(confirm).toHaveBeenLastCalledWith('Remove Hamza from Panel 1? The interview with #7 Sara Ahmed is still on.');
    expect(api.removeFromPanel).toHaveBeenLastCalledWith('u1');

    confirm.mockClear();
    await userEvent.click(within(panels).getByRole('button', { name: 'Remove Omar from Panel 2' }));
    expect(confirm).not.toHaveBeenCalled(); // nothing going on in Panel 2
    expect(api.removeFromPanel).toHaveBeenLastCalledWith('u3');
    confirm.mockRestore();
  });

  it('disables Save while settings or a new password are being saved', async () => {
    let finish = () => {};
    const slow = () => new Promise<void>((resolve) => (finish = resolve));
    await openAdmin({ updateSettings: vi.fn(slow), manageAccount: vi.fn(slow) });

    const settings = screen.getByRole('region', { name: 'Settings' });
    await within(settings).findByDisplayValue('Fall 2026');
    await userEvent.click(within(settings).getByRole('button', { name: 'Save settings' }));
    expect(within(settings).getByRole('button', { name: 'Save settings' })).toBeDisabled();
    finish();
    await waitFor(() => expect(within(settings).getByRole('button', { name: 'Save settings' })).toBeEnabled());

    const queue = await row('Queue Desk');
    await userEvent.click(within(queue).getByRole('button', { name: 'Reset password for Queue Desk' }));
    await userEvent.type(within(queue).getByLabelText('New password for Queue Desk'), 'fresh-password');
    await userEvent.click(within(queue).getByRole('button', { name: 'Save' }));
    expect(within(queue).getByRole('button', { name: 'Save' })).toBeDisabled();
    finish();
    expect(await screen.findByText('Password reset for Queue Desk')).toBeInTheDocument();
  });
});
