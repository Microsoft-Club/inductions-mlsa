import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../supabase/functions/admin-users/validate.ts';

const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('validateCommand', () => {
  it('accepts a create command and normalises the username and name', () => {
    expect(
      validateCommand({ action: 'create', username: '  Yawar_01 ', displayName: ' Yawar ', role: 'panelist', password: 'secret123' }),
    ).toEqual({
      ok: true,
      command: { action: 'create', username: 'yawar_01', displayName: 'Yawar', role: 'panelist', password: 'secret123' },
    });
  });

  it('accepts reset_password and set_active commands', () => {
    expect(validateCommand({ action: 'reset_password', userId: USER_ID, password: 'newpass123' })).toEqual({
      ok: true,
      command: { action: 'reset_password', userId: USER_ID, password: 'newpass123' },
    });
    expect(validateCommand({ action: 'set_active', userId: USER_ID, active: false })).toEqual({
      ok: true,
      command: { action: 'set_active', userId: USER_ID, active: false },
    });
  });

  it.each([
    [null, 'Request body must be an object'],
    [{ action: 'delete' }, 'action must be create, reset_password or set_active'],
    [{ action: 'create', username: 'ab', displayName: 'A', role: 'panelist', password: 'secret123' },
      'Username must be 3 to 32 characters: lowercase letters, digits or _'],
    [{ action: 'create', username: 'has space', displayName: 'A', role: 'panelist', password: 'secret123' },
      'Username must be 3 to 32 characters: lowercase letters, digits or _'],
    [{ action: 'create', username: 'okay', displayName: '   ', role: 'panelist', password: 'secret123' },
      'Name must be 1 to 80 characters'],
    [{ action: 'create', username: 'okay', displayName: 'Okay', role: 'owner', password: 'secret123' },
      'Role must be admin, queue_manager, panelist or photographer'],
    [{ action: 'create', username: 'okay', displayName: 'Okay', role: 'panelist', password: 'short' },
      'Password must be 8 to 72 characters'],
    [{ action: 'reset_password', userId: 'nope', password: 'secret123' }, 'userId must be a UUID'],
    [{ action: 'set_active', userId: USER_ID, active: 'yes' }, 'active must be true or false'],
  ])('rejects %j', (body, error) => {
    expect(validateCommand(body)).toEqual({ ok: false, error });
  });

  it('accepts the photographer role', () => {
    const parsed = validateCommand({ action: 'create', username: 'photos_one', displayName: 'Photos One', role: 'photographer', password: 'long-enough-1' });
    expect(parsed.ok).toBe(true);
  });
});
