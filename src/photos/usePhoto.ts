import { useEffect, useState } from 'react';
import type { Api } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';

// One object URL per candidate *and* version, kept until sign-out. Module-level, so every card and row
// that shows the same photo shares one download. Each version gets its own entry, so fetching a newer
// version (e.g. after a retake) never revokes a URL that another mounted <CandidatePhoto> is still
// showing on screen — nothing still on screen is ever revoked. The server says no-store, so this is the
// only cache, and StaffLayout revokes every object URL and clears the cache when the user signs out (the
// next person on a shared laptop starts empty).
const cache = new Map<string, Promise<string | null>>();

function cacheKey(candidateId: string, version: string): string {
  return `${candidateId}@${version}`;
}

function photoUrl(api: Api, candidateId: string, version: string): Promise<string | null> {
  const key = cacheKey(candidateId, version);
  const hit = cache.get(key);
  if (hit) return hit;
  const url = api.photoBlob(candidateId, version).then(
    (blob) => (blob ? URL.createObjectURL(blob) : null),
    () => null,
  );
  cache.set(key, url);
  // A missing photo or a failed download isn't remembered, so the next time it is shown it is tried again.
  void url.then((u) => {
    if (u === null && cache.get(key) === url) cache.delete(key);
  });
  return url;
}

/** Forgets every photo and frees its memory: revokes every object URL this browser has fetched. */
export function clearPhotoCache(): void {
  for (const url of cache.values()) {
    void url.then((u) => {
      if (u) URL.revokeObjectURL(u);
    });
  }
  cache.clear();
}

/** The photo's object URL; undefined while it loads; null when there is none or it couldn't load. */
export function usePhoto(candidateId: string, version: string | null): string | null | undefined {
  const api = useApi();
  const key = version ? cacheKey(candidateId, version) : null;
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!version || !key) return;
    let current = true;
    void photoUrl(api, candidateId, version).then((url) => {
      if (current) setLoaded({ key, url });
    });
    return () => {
      current = false;
    };
  }, [api, candidateId, version, key]);

  if (!key) return null;
  return loaded?.key === key ? loaded.url : undefined;
}
