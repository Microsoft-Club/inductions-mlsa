import { describe, expect, it } from 'vitest';
import { deleteRefusal, protectedRefusal, validateCommand } from '../../supabase/functions/admin-users/validate.ts';

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

  it('accepts set_role and delete commands', () => {
    expect(validateCommand({ action: 'set_role', userId: USER_ID, role: 'photographer' })).toEqual({
      ok: true,
      command: { action: 'set_role', userId: USER_ID, role: 'photographer' },
    });
    expect(validateCommand({ action: 'delete', userId: USER_ID })).toEqual({
      ok: true,
      command: { action: 'delete', userId: USER_ID },
    });
  });

  it.each([
    [null, 'Request body must be an object'],
    [{ action: 'explode' }, 'action must be create, reset_password, set_active, set_role or delete'],
    [{ action: 'delete' }, 'userId must be a UUID'],
    [{ action: 'set_role', userId: 'nope', role: 'panelist' }, 'userId must be a UUID'],
    [{ action: 'set_role', userId: USER_ID, role: 'owner' }, 'Role must be admin, queue_manager, panelist or photographer'],
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

  it('explains why an account with history cannot be deleted', () => {
    expect(deleteRefusal('Ali Khan', 0, 0)).toBeNull();
    expect(deleteRefusal('Ali Khan', 3, 5)).toBe(
      "Ali Khan has 3 evaluations and 5 chat messages, so the account can't be deleted. Disable it instead.",
    );
    expect(deleteRefusal('Ali Khan', 1, 0)).toBe("Ali Khan has 1 evaluation, so the account can't be deleted. Disable it instead.");
    expect(deleteRefusal('Ali Khan', 0, 1)).toBe("Ali Khan has 1 chat message, so the account can't be deleted. Disable it instead.");
  });

  it("explains that the owner's account is protected", () => {
    expect(protectedRefusal('adminmlsa')).toBe('adminmlsa is protected. Only its owner can change it.');
  });

  it('accepts the photographer role', () => {
    const parsed = validateCommand({ action: 'create', username: 'photos_one', displayName: 'Photos One', role: 'photographer', password: 'long-enough-1' });
    expect(parsed.ok).toBe(true);
  });
});
