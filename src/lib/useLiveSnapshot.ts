import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api.ts';
import type { Subscribe } from './realtime.ts';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

/**
 * Staff screens also reload this often, like the projector: a realtime event lost on the way (a busy
 * server, Wi-Fi that drops one frame) would otherwise leave a board that looks live but isn't.
 */
export const STAFF_RESYNC_MS = 30_000;

export interface LiveSnapshot<T> {
  /** undefined until the first successful load; then always the latest good snapshot. */
  data: T | undefined;
  /** The last load's error, cleared by the next successful load. */
  error: string | null;
  status: LiveStatus;
  reload: () => void;
}

/**
 * Loads a snapshot and reloads it when the realtime channel (re)subscribes, when it delivers an
 * event, when the page comes back into view (a phone unlocked, a laptop woken), and every `pollMs` if
 * given while the page is in view. Loads never overlap: events that arrive during a load cause
 * exactly one more load afterwards. A channel that hasn't joined after `connectTimeoutMs` is
 * reported as reconnecting, so a stuck subscription never looks healthy. `load` and `subscribe`
 * must be stable (useCallback/useMemo).
 */
export function useLiveSnapshot<T>(
  load: () => Promise<T>,
  subscribe: Subscribe,
  pollMs?: number,
  connectTimeoutMs = 15_000,
): LiveSnapshot<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  // `generation` changes whenever the subscription restarts, so late answers for an old one are dropped.
  const loop = useRef({ generation: 0, running: false, again: false });

  const reload = useCallback(() => {
    const state = loop.current;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    void (async () => {
      try {
        do {
          state.again = false;
          const generation = state.generation;
          try {
            const next = await load();
            if (generation === state.generation) {
              setData(next);
              setError(null);
            }
          } catch (e) {
            if (generation === state.generation) setError(errorMessage(e));
          }
        } while (state.again);
      } finally {
        state.running = false;
      }
    })();
  }, [load]);

  useEffect(() => {
    const state = loop.current;
    const generation = ++state.generation;
    let joined = false;
    let channelUp = false;
    setStatus('connecting');
    reload();
    const stop = subscribe({
      onEvent: reload,
      onStatus: (channelStatus) => {
        if (generation !== state.generation) return;
        if (channelStatus === 'subscribed') {
          joined = true;
          channelUp = true;
          setStatus('live');
          reload(); // anything broadcast while we were (re)connecting was missed
        } else {
          channelUp = false;
          setStatus('reconnecting');
        }
      },
    });
    // The browser knows at once when the device drops off the network; the channel only notices at
    // its next missed heartbeat. Say so straight away, and reload the moment the network is back.
    const offline = () => setStatus('reconnecting');
    // A short blip can leave the channel's connection intact, and then it never reports 'subscribed'
    // again; so trust its last report. A connection that did die fails its next heartbeat and rejoins.
    const online = () => {
      if (channelUp) setStatus('live');
      reload();
    };
    // A hidden page (locked phone, sleeping laptop, background tab) skips its polls and catches up the
    // moment it is shown again, before its connection has even noticed it may have died meanwhile.
    const visible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    const timer = pollMs
      ? setInterval(() => {
          if (document.visibilityState !== 'hidden') reload();
        }, pollMs)
      : undefined;
    const stuck = setTimeout(() => {
      if (!joined && generation === state.generation) setStatus('reconnecting');
    }, connectTimeoutMs);
    return () => {
      state.generation++;
      stop();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      if (timer) clearInterval(timer);
      clearTimeout(stuck);
    };
  }, [subscribe, pollMs, connectTimeoutMs, reload]);

  return { data, error, status, reload };
}
