import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcastSubscriber, type ChannelStatus } from '../../../src/lib/realtime.ts';

/** Stands in for a realtime-js channel: the test drives its status callback and events. */
class FakeChannel {
  private statusCallback?: (status: string) => void;
  private listeners: Array<() => void> = [];
  constructor(readonly topic: string, readonly options: unknown) {}
  on(_type: string, _filter: unknown, listener: () => void) {
    this.listeners.push(listener);
    return this;
  }
  subscribe(callback: (status: string) => void) {
    this.statusCallback = callback;
    return this;
  }
  status(status: string) {
    this.statusCallback?.(status);
  }
  event() {
    this.listeners.forEach((listener) => listener());
  }
}

function fakeClient() {
  const channels: FakeChannel[] = [];
  const calls: string[] = [];
  const client = {
    realtime: { setAuth: vi.fn(async () => calls.push('setAuth')) },
    channel: vi.fn((topic: string, options: unknown) => {
      calls.push(`channel ${topic}`);
      const channel = new FakeChannel(topic, options);
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn(async () => 'ok'),
  };
  return { client: client as unknown as SupabaseClient, raw: client, channels, calls };
}

function listen(client: SupabaseClient, topic: string, isPrivate: boolean) {
  const statuses: ChannelStatus[] = [];
  const onEvent = vi.fn();
  const stop = broadcastSubscriber(client, topic, isPrivate)({ onEvent, onStatus: (s) => statuses.push(s) });
  return { statuses, onEvent, stop };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('broadcastSubscriber', () => {
  afterEach(() => vi.useRealTimers());

  it('joins on the next tick and reports statuses and events', async () => {
    const { client, channels } = fakeClient();
    const { statuses, onEvent } = listen(client, 'display:k1', false);
    expect(channels).toHaveLength(0); // deferred, so a StrictMode remount never abandons a channel
    await tick();
    expect(channels.map((c) => [c.topic, c.options])).toEqual([['display:k1', { config: { private: false } }]]);

    channels[0].status('SUBSCRIBED');
    channels[0].event();
    channels[0].status('CHANNEL_ERROR');
    channels[0].status('TIMED_OUT');
    expect(statuses).toEqual(['subscribed', 'error', 'error']);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('passes the signed-in token to realtime before joining a private channel', async () => {
    const { client, calls } = fakeClient();
    listen(client, 'board', true);
    await tick();
    expect(calls).toEqual(['setAuth', 'channel board']);
  });

  it('creates no channel when stopped before joining', async () => {
    const { client, channels } = fakeClient();
    listen(client, 'board', true).stop();
    await tick();
    expect(channels).toHaveLength(0);
  });

  it('leaves when stopped and ignores the channel afterwards', async () => {
    const { client, raw, channels } = fakeClient();
    const { statuses, onEvent, stop } = listen(client, 'board', true);
    await tick();
    stop();
    expect(raw.removeChannel).toHaveBeenCalledWith(channels[0]);
    channels[0].status('CLOSED');
    channels[0].event();
    expect(statuses).toEqual([]);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('starts a new channel when the server closes this one, backing off between tries', async () => {
    vi.useFakeTimers();
    const { client, channels } = fakeClient();
    const { statuses, stop } = listen(client, 'board', true);
    await vi.advanceTimersByTimeAsync(0);
    channels[0].status('SUBSCRIBED');

    channels[0].status('CLOSED'); // e.g. the server ended the channel; realtime-js won't rejoin it
    expect(statuses).toEqual(['subscribed', 'closed']);
    await vi.advanceTimersByTimeAsync(999);
    expect(channels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(channels).toHaveLength(2);

    channels[1].status('CLOSED');
    await vi.advanceTimersByTimeAsync(1999);
    expect(channels).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(channels).toHaveLength(3);
    channels[2].status('SUBSCRIBED');
    expect(statuses.at(-1)).toBe('subscribed');

    channels[2].status('CLOSED');
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(channels).toHaveLength(3); // no rejoin after stop
  });
});
