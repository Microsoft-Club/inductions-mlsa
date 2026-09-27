import { useEffect, useState } from 'react';
import type { Api } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';

// One object URL per candidate, for the version last asked for. Module-level, so every card and row that
// shows the same photo shares one download. The server says no-store, so this is the only cache, and
// StaffLayout clears it when the user signs out (the next person on a shared laptop starts empty).
const cache = new Map<string, { version: string; url: Promise<string | null> }>();

function revoke(url: Promise<string | null>): void {
  void url.then((u) => {
    if (u) URL.revokeObjectURL(u);
  });
}

function photoUrl(api: Api, candidateId: string, version: string): Promise<string | null> {
  const hit = cache.get(candidateId);
  if (hit?.version === version) return hit.url;
  if (hit) revoke(hit.url);
  const url = api.photoBlob(candidateId, version).then(
    (blob) => (blob ? URL.createObjectURL(blob) : null),
    () => null,
  );
  cache.set(candidateId, { version, url });
  // A missing photo or a failed download isn't remembered, so the next time it is shown it is tried again.
  void url.then((u) => {
    if (u === null && cache.get(candidateId)?.url === url) cache.delete(candidateId);
  });
  return url;
}

/** Forgets every photo and frees its memory. */
export function clearPhotoCache(): void {
  for (const { url } of cache.values()) revoke(url);
  cache.clear();
}

/** The photo's object URL; undefined while it loads; null when there is none or it couldn't load. */
export function usePhoto(candidateId: string, version: string | null): string | null | undefined {
  const api = useApi();
  const key = version ? `${candidateId}@${version}` : null;
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
