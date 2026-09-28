// Account conventions shared by the admin-users edge function (Deno), the Node scripts, the tests
// and (Plan 2) the login screen. It has no imports so it runs unchanged in Deno, Node and Vite.

export const INTERNAL_EMAIL_DOMAIN = 'users.induction.local';

export const ROLES = ['admin', 'queue_manager', 'panelist', 'photographer'] as const;
export type Role = (typeof ROLES)[number];

export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

/**
 * The owner's account. No other admin can reset its password, disable it, change its role or delete
 * it; only the owner can change it (reset their own password). To protect another account, add it here.
 */
export const PROTECTED_USERNAMES: readonly string[] = ['adminmlsa'];

export function isProtectedAccount(username: string): boolean {
  return PROTECTED_USERNAMES.includes(username.trim().toLowerCase());
}

/** People log in with a username; Supabase Auth needs an email, so we derive a private one. */
export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
}

export interface NewAccount {
  username: string;
  displayName: string;
  role: Role;
  password: string;
}

export type CreateAccountResult = { ok: true; userId: string } | { ok: false; error: string };

/** The parts of a service-role supabase-js client used here, typed loosely so Deno and Node share it. */
export interface ServiceClient {
  // deno-lint-ignore no-explicit-any
  auth: { admin: { createUser(attrs: any): Promise<any>; deleteUser(id: string): Promise<any> } };
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

/**
 * Creates the auth user and its profile row. Profiles are only ever written with the service role,
 * so an auth user without a profile (for example an accidental self-signup) has no role and no access.
 */
export async function createAccount(client: ServiceClient, account: NewAccount): Promise<CreateAccountResult> {
  const { data, error } = await client.auth.admin.createUser({
    email: usernameToEmail(account.username),
    password: account.password,
    email_confirm: true,
  });
  if (error || !data?.user) {
    const message: string = error?.message ?? 'Could not create the account';
    return { ok: false, error: /already/i.test(message) ? 'Username already taken' : message };
  }

  const { error: profileError } = await client.from('profiles').insert({
    id: data.user.id,
    username: account.username,
    display_name: account.displayName,
    role: account.role,
  });
  if (profileError) {
    await client.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: profileError.message };
  }
  return { ok: true, userId: data.user.id };
}
