// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelStatus, Subscribe } from '../../../src/lib/realtime.ts';
import { useLiveSnapshot } from '../../../src/lib/useLiveSnapshot.ts';

function fakeChannel() {
  let handlers: Parameters<Subscribe>[0] | undefined;
  const stop = vi.fn();
  const subscribe: Subscribe = (h) => {
    handlers = h;
    return stop;
  };
  return {
    subscribe,
    stop,
    event: () => act(() => handlers!.onEvent()),
    status: (status: ChannelStatus) => act(() => handlers!.onStatus(status)),
  };
}

/** load() calls that stay pending until the test settles them. */
function manualLoads() {
  const pending: Array<{ resolve: (value: number) => void; reject: (error: Error) => void }> = [];
  const load = vi.fn(() => new Promise<number>((resolve, reject) => pending.push({ resolve, reject })));
  const settle = async (i: number, outcome: number | Error) => {
    await act(async () => {
      if (outcome instanceof Error) pending[i].reject(outcome);
      else pending[i].resolve(outcome);
    });
  };
  return { load, pending, settle };
}

describe('useLiveSnapshot', () => {
  it('loads on mount, then reloads when the channel subscribes', async () => {
    const channel = fakeChannel();
    let n = 0;
    const load = vi.fn(async () => ++n);
    const { result } = renderHook(() => useLiveSnapshot(load, channel.subscribe));
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(result.current.status).toBe('connecting');

    channel.status('subscribed');
    expect(result.current.status).toBe('live');
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it('never runs two loads at once; events during a load cause exactly one more', async () => {
    const channel = fakeChannel();
    const { load, settle } = manualLoads();
    const { result } = renderHook(() => useLiveSnapshot(load, channel.subscribe));
    expect(load).toHaveBeenCalledTimes(1);

    channel.event();
    channel.event();
    channel.event();
    expect(load).toHaveBeenCalledTimes(1);

    await settle(0, 1);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await settle(1, 2);
    expect(result.current.data).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good snapshot when a reload fails, and clears the error on the next success', async () => {
    const channel = fakeChannel();
    const { load, settle } = manualLoads();
    const { result } = renderHook(() => useLiveSnapshot(load, channel.subscribe));
    await settle(0, 1);

    channel.event();
    await settle(1, new Error('Network down'));
    expect(result.current.data).toBe(1);
    expect(result.current.error).toBe('Network down');

    channel.event();
    await settle(2, 3);
    expect(result.current.data).toBe(3);
    expect(result.current.error).toBeNull();
  });

  it('reports reconnecting until the channel subscribes again', () => {
    const channel = fakeChannel();
    const load = vi.fn(async () => 1);
    const { result } = renderHook(() => useLiveSnapshot(load, channel.subscribe));
    channel.status('subscribed');
    channel.status('error');
    expect(result.current.status).toBe('reconnecting');
    channel.status('closed');
    expect(result.current.status).toBe('reconnecting');
    channel.status('subscribed');
    expect(result.current.status).toBe('live');
  });

  it('polls when asked to', async () => {
    const channel = fakeChannel();
    const load = vi.fn(async () => 1);
    renderHook(() => useLiveSnapshot(load, channel.subscribe, 20));
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it('stops listening on unmount and ignores later events', async () => {
    const channel = fakeChannel();
    const load = vi.fn(async () => 1);
    const { unmount } = renderHook(() => useLiveSnapshot(load, channel.subscribe));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    unmount();
    expect(channel.stop).toHaveBeenCalledTimes(1);
  });

  it('reports reconnecting when the channel never manages to join', async () => {
    const channel = fakeChannel();
    const load = vi.fn(async () => 1);
    const { result } = renderHook(() => useLiveSnapshot(load, channel.subscribe, undefined, 30));
    expect(result.current.status).toBe('connecting');
    await waitFor(() => expect(result.current.status).toBe('reconnecting'));
    channel.status('subscribed');
    expect(result.current.status).toBe('live');
  });
});

describe('useLiveSnapshot when the device loses its network', () => {
  const goOffline = () => act(() => void window.dispatchEvent(new Event('offline')));
  const goOnline = () => act(() => void window.dispatchEvent(new Event('online')));

  it('reports reconnecting as soon as the browser says it is offline', () => {
    const channel = fakeChannel();
    const load = vi.fn(async () => 1);
    const { result } = renderHook(() => useLiveSnapshot(load, channel.subscribe));
    channel.status('subscribed');
    goOffline();
    expect(result.current.status).toBe('reconnecting');
  });

  it('reloads the moment the network is back, and is live again if the channel held on', async () => {
    const channel = fakeChannel();
    const load = vi.fn(async () => 1);
    const { result } = renderHook(() => useLiveSnapshot(load, channel.subscribe));
    channel.status('subscribed');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    goOffline();
    goOnline();
    expect(result.current.status).toBe('live');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  });

  it('stays reconnecting after the network is back until a dropped channel joins again', () => {
    const channel = fakeChannel();
    const load = vi.fn(async () => 1);
    const { result } = renderHook(() => useLiveSnapshot(load, channel.subscribe));
    channel.status('subscribed');
    goOffline();
    channel.status('error');
    goOnline();
    expect(result.current.status).toBe('reconnecting');
    channel.status('subscribed');
    expect(result.current.status).toBe('live');
  });

  it('stops listening for network changes on unmount', async () => {
    const channel = fakeChannel();
    const load = vi.fn(async () => 1);
    const { unmount } = renderHook(() => useLiveSnapshot(load, channel.subscribe));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    unmount();
    goOnline();
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(1);
  });
});
