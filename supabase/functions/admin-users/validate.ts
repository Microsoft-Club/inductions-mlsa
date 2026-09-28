import { ROLES, USERNAME_PATTERN, type Role } from '../_shared/accounts.ts';

export type AdminUsersCommand =
  | { action: 'create'; username: string; displayName: string; role: Role; password: string }
  | { action: 'reset_password'; userId: string; password: string }
  | { action: 'set_active'; userId: string; active: boolean }
  | { action: 'set_role'; userId: string; role: Role }
  | { action: 'delete'; userId: string };

export type Validation = { ok: true; command: AdminUsersCommand } | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_ERROR = 'Role must be admin, queue_manager, panelist or photographer';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Why an account can't be deleted, or null when it can. Evaluations and chat messages point at their
 * author and must survive, so an account with any of them is disabled instead of deleted.
 */
export function deleteRefusal(name: string, evaluations: number, messages: number): string | null {
  const history = [
    evaluations > 0 ? count(evaluations, 'evaluation', 'evaluations') : null,
    messages > 0 ? count(messages, 'chat message', 'chat messages') : null,
  ].filter(Boolean);
  if (history.length === 0) return null;
  return `${name} has ${history.join(' and ')}, so the account can't be deleted. Disable it instead.`;
}

function passwordError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    return 'Password must be 8 to 72 characters';
  }
  return null;
}

function userIdError(userId: unknown): string | null {
  return typeof userId === 'string' && UUID_PATTERN.test(userId) ? null : 'userId must be a UUID';
}

/** Validates an admin-users request body. Pure, so it is unit-tested outside Deno. */
export function validateCommand(body: unknown): Validation {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be an object' };
  }
  const b = body as Record<string, unknown>;

  switch (b.action) {
    case 'create': {
      const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
      if (!USERNAME_PATTERN.test(username)) {
        return { ok: false, error: 'Username must be 3 to 32 characters: lowercase letters, digits or _' };
      }
      const displayName = typeof b.displayName === 'string' ? b.displayName.trim() : '';
      if (displayName.length < 1 || displayName.length > 80) {
        return { ok: false, error: 'Name must be 1 to 80 characters' };
      }
      if (!ROLES.includes(b.role as Role)) return { ok: false, error: ROLE_ERROR };
      const pwError = passwordError(b.password);
      if (pwError) return { ok: false, error: pwError };
      return {
        ok: true,
        command: { action: 'create', username, displayName, role: b.role as Role, password: b.password as string },
      };
    }
    case 'reset_password': {
      const idError = userIdError(b.userId);
      if (idError) return { ok: false, error: idError };
      const pwError = passwordError(b.password);
      if (pwError) return { ok: false, error: pwError };
      return { ok: true, command: { action: 'reset_password', userId: b.userId as string, password: b.password as string } };
    }
    case 'set_active': {
      const idError = userIdError(b.userId);
      if (idError) return { ok: false, error: idError };
      if (typeof b.active !== 'boolean') return { ok: false, error: 'active must be true or false' };
      return { ok: true, command: { action: 'set_active', userId: b.userId as string, active: b.active } };
    }
    case 'set_role': {
      const idError = userIdError(b.userId);
      if (idError) return { ok: false, error: idError };
      if (!ROLES.includes(b.role as Role)) return { ok: false, error: ROLE_ERROR };
      return { ok: true, command: { action: 'set_role', userId: b.userId as string, role: b.role as Role } };
    }
    case 'delete': {
      const idError = userIdError(b.userId);
      if (idError) return { ok: false, error: idError };
      return { ok: true, command: { action: 'delete', userId: b.userId as string } };
    }
    default:
      return { ok: false, error: 'action must be create, reset_password, set_active, set_role or delete' };
  }
}
