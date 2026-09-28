import { describe, expect, it } from 'vitest';
import { createAccount, isProtectedAccount, usernameToEmail } from '../../supabase/functions/_shared/accounts.ts';

function fakeClient(opts: { createError?: string; insertError?: string } = {}) {
  const calls = { createUser: [] as unknown[], insert: [] as unknown[], deleteUser: [] as string[] };
  const client = {
    auth: {
      admin: {
        createUser: async (attrs: unknown) => {
          calls.createUser.push(attrs);
          return opts.createError
            ? { data: { user: null }, error: { message: opts.createError } }
            : { data: { user: { id: 'user-1' } }, error: null };
        },
        deleteUser: async (id: string) => {
          calls.deleteUser.push(id);
          return { error: null };
        },
      },
    },
    from: (table: string) => ({
      insert: async (row: unknown) => {
        calls.insert.push({ table, row });
        return { error: opts.insertError ? { message: opts.insertError } : null };
      },
    }),
  };
  return { client, calls };
}

const account = { username: 'yawar', displayName: 'Yawar', role: 'panelist' as const, password: 'secret123' };

describe('usernameToEmail', () => {
  it('maps usernames to the internal email domain', () => {
    expect(usernameToEmail(' Yawar_01 ')).toBe('yawar_01@users.induction.local');
  });
});

describe('isProtectedAccount', () => {
  it('protects the owner account, however it is written', () => {
    expect(isProtectedAccount('adminmlsa')).toBe(true);
    expect(isProtectedAccount(' AdminMLSA ')).toBe(true);
  });
  it('leaves every other account alone', () => {
    expect(isProtectedAccount('admin')).toBe(false);
    expect(isProtectedAccount('adminmlsa2')).toBe(false);
  });
});

describe('createAccount', () => {
  it('creates a confirmed auth user and its profile row', async () => {
    const { client, calls } = fakeClient();
    await expect(createAccount(client, account)).resolves.toEqual({ ok: true, userId: 'user-1' });
    expect(calls.createUser).toEqual([{ email: 'yawar@users.induction.local', password: 'secret123', email_confirm: true }]);
    expect(calls.insert).toEqual([
      { table: 'profiles', row: { id: 'user-1', username: 'yawar', display_name: 'Yawar', role: 'panelist' } },
    ]);
  });

  it('reports a taken username in plain words', async () => {
    const { client, calls } = fakeClient({ createError: 'A user with this email address has already been registered' });
    await expect(createAccount(client, account)).resolves.toEqual({ ok: false, error: 'Username already taken' });
    expect(calls.insert).toEqual([]);
  });

  it('removes the auth user again if the profile cannot be saved', async () => {
    const { client, calls } = fakeClient({ insertError: 'duplicate key value violates unique constraint' });
    await expect(createAccount(client, account)).resolves.toEqual({
      ok: false,
      error: 'duplicate key value violates unique constraint',
    });
    expect(calls.deleteUser).toEqual(['user-1']);
  });
});
