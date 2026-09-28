import { parseServerTime } from '../lib/clock.ts';
import type { PhotoQueueEntry } from '../lib/types.ts';

export interface PhotoLists {
  needs: PhotoQueueEntry[];
  done: PhotoQueueEntry[];
}

/** "12", "#12" (numbers starting with those digits) or the start of any word in the name. An empty search matches everyone. */
export function matchesPhotoSearch(entry: PhotoQueueEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = /^#?(\d+)$/.exec(q);
  if (digits) return String(entry.number).startsWith(digits[1]);
  const queryWords = q.split(/\s+/).filter(Boolean);
  const nameWords = entry.name.toLowerCase().split(/\s+/);
  return queryWords.every((queryWord) => nameWords.some((nameWord) => nameWord.startsWith(queryWord)));
}

const time = (iso: string | null) => (iso ? parseServerTime(iso) : 0);

/** Needs photo: earliest check-in first. Done: most recent photo first (the one just taken is on top). */
export function photoLists(entries: PhotoQueueEntry[], query = ''): PhotoLists {
  const shown = entries.filter((entry) => matchesPhotoSearch(entry, query));
  return {
    needs: shown
      .filter((entry) => !entry.photo_taken_at)
      .sort((a, b) => time(a.checked_in_at) - time(b.checked_in_at) || a.number - b.number),
    done: shown
      .filter((entry) => entry.photo_taken_at)
      .sort((a, b) => time(b.photo_taken_at) - time(a.photo_taken_at) || a.number - b.number),
  };
}

/** Across everyone waiting, whatever the search. */
export function photoCounts(entries: PhotoQueueEntry[]): { needs: number; done: number } {
  const done = entries.filter((entry) => entry.photo_taken_at).length;
  return { needs: entries.length - done, done };
}
