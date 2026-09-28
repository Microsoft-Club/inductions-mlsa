import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { validateCommand } from '../../supabase/functions/admin-users/validate.ts';
import { isProtectedAccount, ROLES, type Role } from '../../supabase/functions/_shared/accounts.ts';
import { ROLE_LABELS } from '../app/homePath.ts';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider, useRunAction } from '../components/ActionProvider.tsx';
import { useToast } from '../components/Toasts.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import type { Account, Profile } from '../lib/types.ts';
import { generatePassword } from './password.ts';

const inputClasses = 'mt-1 block h-9 w-full rounded-md border border-slate-300 px-2 text-sm font-normal focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none';

/** Everyone who can sign in: create, reset passwords, change roles, disable, enable and delete (through the admin-users edge function). */
export function AccountsSection({ me }: { me: Profile }) {
  const api = useApi();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listAccounts().then(
      (rows) => {
        setAccounts(rows);
        setError(null);
      },
      (e) => setError(errorMessage(e)),
    );
  }, [api]);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="accounts-title" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="accounts-title" className="font-semibold">Accounts</h2>
      <ActionProvider onSettled={load}>
        <CreateAccountForm />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {accounts === null ? (
          !error && <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Username</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((account) => (
                  <AccountRow key={account.id} account={account} isMe={account.id === me.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ActionProvider>
    </section>
  );
}

function AccountRow({ account, isMe }: { account: Account; isMe: boolean }) {
  const api = useApi();
  const run = useRunAction();
  const toast = useToast();
  const [editing, setEditing] = useState<'password' | 'role' | null>(null);
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(account.role);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = account.display_name;
  // The owner's account: other admins see it, but can't change it.
  const locked = !isMe && isProtectedAccount(account.username);

  function close() {
    setEditing(null);
    setPassword('');
    setProblem(null);
  }

  /** Checks a command the same way the edge function will, then sends it. */
  async function send(body: unknown, success: string) {
    const parsed = validateCommand(body);
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    setSaving(true);
    const done = await run(async () => {
      await api.manageAccount(parsed.command);
      return true;
    });
    setSaving(false);
    if (done) {
      toast.show(success, 'success');
      close();
    }
  }

  function saveReset(event: FormEvent) {
    event.preventDefault();
    void send({ action: 'reset_password', userId: account.id, password }, `Password reset for ${name}`);
  }

  function saveRole(event: FormEvent) {
    event.preventDefault();
    void send({ action: 'set_role', userId: account.id, role }, `${name}'s role is now ${ROLE_LABELS[role]}`);
  }

  return (
    <tr className={account.is_active ? '' : 'text-slate-500'}>
      <td className="py-2 pr-3 font-medium">{name}</td>
      <td className="py-2 pr-3 font-mono text-xs">{account.username}</td>
      <td className="py-2 pr-3">{ROLE_LABELS[account.role]}</td>
      <td className="py-2 pr-3">{account.is_active ? 'Active' : 'Disabled'}</td>
      <td className="py-2">
        {editing === 'password' ? (
          <form noValidate className="flex flex-wrap items-center gap-2" onSubmit={saveReset}>
            <input
              aria-label={`New password for ${name}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-8 w-40 rounded-md border border-slate-300 px-2 text-sm"
              autoFocus
            />
            <button type="button" className={buttonClasses('ghost')} onClick={() => setPassword(generatePassword())}>
              Generate
            </button>
            <button type="submit" className={buttonClasses('primary')} disabled={saving}>
              Save
            </button>
            <button type="button" className={buttonClasses('ghost')} onClick={close}>
              Cancel
            </button>
            {problem && <span role="alert" className="text-xs text-red-700">{problem}</span>}
          </form>
        ) : editing === 'role' ? (
          <form noValidate className="flex flex-wrap items-center gap-2" onSubmit={saveRole}>
            <select
              aria-label={`New role for ${name}`}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
              autoFocus
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClasses('primary')} disabled={saving || role === account.role}>
              Save
            </button>
            <button type="button" className={buttonClasses('ghost')} onClick={close}>
              Cancel
            </button>
            {problem && <span role="alert" className="text-xs text-red-700">{problem}</span>}
          </form>
        ) : locked ? (
          <p className="text-right text-xs font-medium text-slate-500" title="Only its owner can change this account">
            Protected
          </p>
        ) : (
          <div className="flex flex-wrap justify-end gap-1">
            <button type="button" className={buttonClasses('secondary')} aria-label={`Reset password for ${name}`} onClick={() => setEditing('password')}>
              Reset password
            </button>
            {!isMe && (
              <>
                <button
                  type="button"
                  className={buttonClasses('secondary')}
                  aria-label={`Change role for ${name}`}
                  onClick={() => {
                    setRole(account.role);
                    setEditing('role');
                  }}
                >
                  Change role
                </button>
                {account.is_active ? (
                  <ActionButton
                    variant="danger"
                    label={`Disable ${name}`}
                    confirm={`Disable ${name}? They are signed out and can't sign in until an admin enables the account again.`}
                    action={() => api.manageAccount({ action: 'set_active', userId: account.id, active: false })}
                  >
                    Disable
                  </ActionButton>
                ) : (
                  <ActionButton label={`Enable ${name}`} action={() => api.manageAccount({ action: 'set_active', userId: account.id, active: true })}>
                    Enable
                  </ActionButton>
                )}
                <ActionButton
                  variant="danger"
                  label={`Delete ${name}`}
                  confirm={`Delete ${name} (${account.username})? This can't be undone.`}
                  action={async () => {
                    await api.manageAccount({ action: 'delete', userId: account.id });
                    toast.show(`Deleted the account for ${name}`, 'success');
                  }}
                >
                  Delete
                </ActionButton>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

/** Runs inside the section's ActionProvider, whose onSettled reloads the list. */
function CreateAccountForm() {
  const api = useApi();
  const run = useRunAction();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('panelist');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // The same checks the edge function makes, so mistakes show up before anything is sent.
    const parsed = validateCommand({ action: 'create', username, displayName, role, password });
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    setPending(true);
    const done = await run(async () => {
      await api.manageAccount(parsed.command);
      return true;
    });
    setPending(false);
    if (done) {
      toast.show(`Account created for ${displayName.trim()}. Give them the username and password.`, 'success');
      setUsername('');
      setDisplayName('');
      setPassword('');
    }
  }

  return (
    <form noValidate aria-labelledby="new-account-title" className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-5" onSubmit={(e) => void submit(e)}>
      <h3 id="new-account-title" className="text-sm font-semibold sm:col-span-5">New account</h3>
      <label className="text-sm font-medium">
        Username
        <input className={inputClasses} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="text-sm font-medium">
        Name
        <input className={inputClasses} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="text-sm font-medium">
        Role
        <select className={inputClasses} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <div className="text-sm font-medium">
        <label htmlFor="new-account-password">Password</label>
        <div className="mt-1 flex gap-1">
          <input id="new-account-password" className={`${inputClasses} mt-0`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className={buttonClasses('ghost')} onClick={() => setPassword(generatePassword())}>
            Generate
          </button>
        </div>
      </div>
      <div className="flex items-end">
        <button type="submit" className={`${buttonClasses('primary', 'md')} w-full`} disabled={pending}>
          Create account
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-5">
          {problem}
        </p>
      )}
    </form>
  );
}
