// The interviews a panelist sat in, remembered on this device. The server only knows an interview's
// panel, not who sat in it, so after a switch the screen would lose an interview they still owe an
// evaluation for. Kept in localStorage per person, like chat drafts; forgotten once evaluated.

const KEY_PREFIX = 'induction:sat-in:';

/** More than a day of interviews; the oldest are dropped first. */
const MAX_REMEMBERED = 100;

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** The remembered interview ids, oldest first; none if storage is damaged or unavailable. */
export function loadSatIn(userId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(userId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function save(userId: string, ids: string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(key(userId));
    else localStorage.setItem(key(userId), JSON.stringify(ids.slice(-MAX_REMEMBERED)));
  } catch {
    // Storage full or blocked: the screen still works, it just can't follow you to another panel.
  }
}

export function rememberSatIn(userId: string, interviewId: string): void {
  const ids = loadSatIn(userId);
  if (!ids.includes(interviewId)) save(userId, [...ids, interviewId]);
}

/** Evaluated, cancelled or from another induction: no longer worth bringing back. */
export function forgetSatIn(userId: string, interviewIds: Iterable<string>): void {
  const gone = new Set(interviewIds);
  const ids = loadSatIn(userId);
  const kept = ids.filter((id) => !gone.has(id));
  if (kept.length !== ids.length) save(userId, kept);
}
