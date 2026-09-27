import type { Role } from '../lib/types.ts';

export function homePath(role: Role): string {
  if (role === 'queue_manager') return '/queue';
  if (role === 'panelist') return '/panel';
  if (role === 'photographer') return '/photos';
  return '/admin';
}

/** A ?next= target, only if it is a path on this site (never "//other.site" or the login page). */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/login')) return null;
  return next;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  queue_manager: 'Queue manager',
  panelist: 'Panelist',
  photographer: 'Photographer',
};
