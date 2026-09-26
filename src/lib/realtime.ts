import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export type ChannelStatus = 'subscribed' | 'error' | 'closed';

/**
 * Starts listening to one realtime topic and returns a function that stops. Screens treat every
 * event as "reload your snapshot" and every (re)subscription as "reload, you may have missed events".
 */
export type Subscribe = (handlers: { onEvent: () => void; onStatus: (status: ChannelStatus) => void }) => () => void;

/** Waits between attempts to rejoin a channel the server closed: 1 s, 2 s, 5 s, then every 10 s. */
const REJOIN_DELAYS_MS = [1000, 2000, 5000, 10_000];

export function broadcastSubscriber(client: SupabaseClient, topic: string, isPrivate: boolean): Subscribe {
  return ({ onEvent, onStatus }) => {
    let stopped = false;
    let channel: RealtimeChannel | null = null;
    let attempt = 0;
    let rejoinTimer: ReturnType<typeof setTimeout> | undefined;

    const join = async () => {
      if (isPrivate) {
        try {
          await client.realtime.setAuth(); // private channels need the signed-in user's token
        } catch {
          // The join below then fails and reports CHANNEL_ERROR, which the screen shows.
        }
      }
      // Deferred, so React StrictMode's mount → unmount → mount never creates a channel it abandons.
      await Promise.resolve();
      if (stopped) return;
      const current = client.channel(topic, { config: { private: isPrivate } }).on('broadcast', { event: '*' }, () => {
        if (!stopped && channel === current) onEvent();
      });
      channel = current;
      current.subscribe((status) => {
        if (stopped || channel !== current) return;
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          onStatus('subscribed');
        } else if (status === 'CLOSED') {
          // The server ended this channel. realtime-js rejoins after errors and dropped sockets, but
          // not after a close, so start a fresh channel (it has already left the client's list).
          onStatus('closed');
          channel = null;
          const delay = REJOIN_DELAYS_MS[Math.min(attempt++, REJOIN_DELAYS_MS.length - 1)];
          rejoinTimer = setTimeout(() => void join(), delay);
        } else {
          onStatus('error');
        }
      });
    };

    void join();
    return () => {
      stopped = true;
      clearTimeout(rejoinTimer);
      if (channel) void client.removeChannel(channel);
    };
  };
}
