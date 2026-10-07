import { createClient, FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createApi,
  friendlyMessage,
  NETWORK_ERROR,
  NOT_ALLOWED,
  PHOTO_TIMEOUT_ERROR,
  SESSION_ERROR,
  TIMEOUT_ERROR,
  type ApiOptions,
  type PhotoFetch,
} from '../../../src/lib/api.ts';
import { notAllowed } from '../../../src/lib/notAllowed.ts';

/** Stands in for a postgrest-js query: awaitable, with .abortSignal(). */
function query(result: Promise<unknown>) {
  return { abortSignal: () => result };
}

function clientReturning(response: { data?: unknown; error?: { message: string; code?: string } | null; status?: number }) {
  const rpc = vi.fn(() => query(Promise.resolve({ data: null, error: null, status: 200, ...response })));
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}

describe('friendlyMessage', () => {
  it('passes the database message through', () => {
    expect(friendlyMessage({ message: 'Panel 2 is busy', code: 'P0001' }, 400)).toBe('Panel 2 is busy');
  });
  it('maps permission errors and network failures', () => {
    expect(friendlyMessage({ message: 'Not allowed', code: '42501' }, 403)).toBe(NOT_ALLOWED);
    // 401: sent without a valid sign-in (its renewal is waiting out a failure), not a refusal
    expect(friendlyMessage({ message: 'permission denied for function board_snapshot', code: '42501' }, 401)).toBe(SESSION_ERROR);
    expect(friendlyMessage({ message: 'JWT expired', code: 'PGRST303' }, 401)).toBe(SESSION_ERROR);
    expect(friendlyMessage({ message: 'TypeError: Failed to fetch', code: '' }, 0)).toBe(NETWORK_ERROR);
    expect(friendlyMessage({ message: '' }, 500)).toBe('Something went wrong');
  });
});

describe('createApi', () => {
  it('calls each database function with its argument names', async () => {
    const { rpc, client } = clientReturning({ data: 'interview-1' });
    const api = createApi(client);
    await expect(api.sendIn('c1', 'p1')).resolves.toBe('interview-1');
    await api.moveCandidate('c1', null, null);
    await api.importCandidates([]);
    await api.dismissFormWarning('w1');
    await api.removeFromPanel('u1');
    await api.markPanelReady('i1');
    expect(rpc.mock.calls).toEqual([
      ['send_in', { p_candidate_id: 'c1', p_panel_id: 'p1' }],
      ['move_candidate', { p_candidate_id: 'c1', p_panel_id: null, p_position: null }],
      ['import_candidates', { p_rows: [] }],
      ['dismiss_form_warning', { p_id: 'w1' }],
      ['remove_from_panel', { p_user_id: 'u1' }],
      ['mark_panel_ready', { p_interview_id: 'i1' }],
    ]);
  });

  it('rejects with the server message', async () => {
    const api = createApi(clientReturning({ error: { message: 'Candidate #4 is not waiting', code: 'P0001' }, status: 400 }).client);
    await expect(api.checkIn('c4')).rejects.toEqual(new ApiError('Candidate #4 is not waiting'));
  });

  it('announces "Not allowed" so a disabled account gets signed out', async () => {
    const listener = vi.fn();
    const stop = notAllowed.subscribe(listener);
    const api = createApi(clientReturning({ error: { message: 'Not allowed', code: '42501' }, status: 403 }).client);
    await expect(api.boardSnapshot()).rejects.toThrow(NOT_ALLOWED);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not announce "Not allowed" for a request sent without a valid sign-in', async () => {
    // After a long drop supabase-js can't renew the token for up to a minute and sends requests signed
    // out; the server answers 401. Announcing "Not allowed" made the screen sign the person out.
    const listener = vi.fn();
    const stop = notAllowed.subscribe(listener);
    const api = createApi(clientReturning({ error: { message: 'permission denied for function board_snapshot', code: '42501' }, status: 401 }).client);
    await expect(api.boardSnapshot()).rejects.toThrow(SESSION_ERROR);
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('turns a thrown fetch into the network message', async () => {
    const rpc = vi.fn(() => query(Promise.reject(new TypeError('Failed to fetch'))));
    const api = createApi({ rpc } as unknown as SupabaseClient);
    await expect(api.serverNow()).rejects.toThrow(NETWORK_ERROR);
  });

  it('gives up on a call that takes too long, instead of waiting forever', async () => {
    // A real supabase-js client whose requests never get an answer (e.g. the venue's uplink stalls).
    const stalled: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const client = createClient('http://127.0.0.1:9', 'anon-key', { auth: { persistSession: false }, global: { fetch: stalled } });
    const api = createApi(client, { timeoutMs: 50 });
    await expect(api.boardSnapshot()).rejects.toThrow(TIMEOUT_ERROR);
    await expect(api.listCandidates('ind-1')).rejects.toThrow(TIMEOUT_ERROR);
  }, 3000);
});

describe('panelist, admin and results calls', () => {
  it('call each database function with its argument names', async () => {
    const { rpc, client } = clientReturning({ data: null });
    const api = createApi(client);
    await api.setMyPanel('p1');
    await api.setMyPanel(null);
    await api.postMessage('i1', 'Strong answers', 'm1');
    await api.submitEvaluation('i1', { communication: 4 }, 'yes', 'Good');
    await api.updateSettings('Fall 2026', 20);
    await api.setDecision('c1', 'selected');
    await api.setResultsPublished(true);
    expect(rpc.mock.calls).toEqual([
      ['set_my_panel', { p_panel_id: 'p1' }],
      ['set_my_panel', { p_panel_id: null }],
      ['post_message', { p_interview_id: 'i1', p_body: 'Strong answers', p_id: 'm1' }],
      ['submit_evaluation', { p_interview_id: 'i1', p_scores: { communication: 4 }, p_recommendation: 'yes', p_comments: 'Good' }],
      ['update_settings', { p_name: 'Fall 2026', p_target_minutes: 20 }],
      ['set_decision', { p_candidate_id: 'c1', p_decision: 'selected' }],
      ['set_results_published', { p_published: true }],
    ]);
  });
});

describe('manageAccount', () => {
  function functionsClient(result: { data: unknown; error: unknown }) {
    const invoke = vi.fn(async () => result);
    return { invoke, client: { functions: { invoke } } as unknown as SupabaseClient };
  }

  it('sends the command to the admin-users edge function', async () => {
    const { invoke, client } = functionsClient({ data: { ok: true }, error: null });
    await createApi(client).manageAccount({ action: 'set_active', userId: 'u1', active: false });
    expect(invoke).toHaveBeenCalledWith('admin-users', expect.objectContaining({ body: { action: 'set_active', userId: 'u1', active: false } }));
  });

  it("shows the function's own message", async () => {
    const error = new FunctionsHttpError(new Response(JSON.stringify({ error: 'Username already taken' }), { status: 400 }));
    const { client } = functionsClient({ data: null, error });
    await expect(
      createApi(client).manageAccount({ action: 'create', username: 'hina', displayName: 'Hina', role: 'panelist', password: 'long-enough' }),
    ).rejects.toEqual(new ApiError('Username already taken'));
  });

  it('treats a request without a valid sign-in as the sign-in reconnecting, without announcing anything', async () => {
    const listener = vi.fn();
    const stop = notAllowed.subscribe(listener);
    const error = new FunctionsHttpError(new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 }));
    const { client } = functionsClient({ data: null, error });
    await expect(createApi(client).manageAccount({ action: 'set_active', userId: 'u1', active: true })).rejects.toThrow(SESSION_ERROR);
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('treats a refusal as "Not allowed" and announces it', async () => {
    const listener = vi.fn();
    const stop = notAllowed.subscribe(listener);
    const error = new FunctionsHttpError(new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403 }));
    const { client } = functionsClient({ data: null, error });
    await expect(createApi(client).manageAccount({ action: 'set_active', userId: 'u1', active: true })).rejects.toThrow(NOT_ALLOWED);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reports an unreachable function as a network problem', async () => {
    const { client } = functionsClient({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) });
    await expect(createApi(client).manageAccount({ action: 'set_active', userId: 'u1', active: true })).rejects.toThrow(NETWORK_ERROR);
  });
});

describe('photo calls', () => {
  const session = { data: { session: { access_token: 'user-token' } } };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  function photoApi(photoFetch: PhotoFetch, options: ApiOptions = {}) {
    const rpc = vi.fn(() => query(Promise.resolve({ data: 5, error: null, status: 200 })));
    const client = { rpc, auth: { getSession: vi.fn(async () => session) } } as unknown as SupabaseClient;
    return { rpc, api: createApi(client, { ...options, photoFetch }) };
  }

  it("uploads the JPEG with the signed-in user's token", async () => {
    const photoFetch = vi.fn(async (_url: string, _init: RequestInit) => json({ photo_taken_at: '2026-09-27T10:00:00+00:00' }));
    const { api } = photoApi(photoFetch);
    const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });

    await expect(api.uploadPhoto('c1', jpeg)).resolves.toBe('2026-09-27T10:00:00+00:00');
    const [url, init] = photoFetch.mock.calls[0];
    expect(url).toBe('/api/photos/c1');
    expect(init).toMatchObject({ method: 'PUT', body: jpeg, headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer user-token' } });
  });

  it('downloads a photo by version, and gives null when there is none', async () => {
    const photoFetch = vi.fn(async (url: string, _init: RequestInit) =>
      url.startsWith('/api/photos/c1') ? new Response(new Blob(['jpeg'])) : json({ error: 'No photo' }, 404),
    );
    const { api } = photoApi(photoFetch);

    const blob = await api.photoBlob('c1', '2026-09-27T10:00:00+00:00');
    expect(await blob?.text()).toBe('jpeg');
    expect(photoFetch.mock.calls[0][0]).toBe('/api/photos/c1?v=2026-09-27T10%3A00%3A00%2B00%3A00');
    await expect(api.photoBlob('c2', 'v1')).resolves.toBeNull();
  });

  it('deletes every photo and reports how many', async () => {
    const photoFetch = vi.fn(async (_url: string, _init: RequestInit) => json({ deleted: 3 }));
    const { api } = photoApi(photoFetch);

    await expect(api.deleteAllPhotos()).resolves.toBe(3);
    expect(photoFetch.mock.calls[0][0]).toBe('/api/photos');
    expect(photoFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it("shows the server's message; 401 is the sign-in reconnecting, 403 is \"Not allowed\"", async () => {
    const listener = vi.fn();
    const stop = notAllowed.subscribe(listener);
    const replies = [json({ error: 'Candidate #12 is not waiting' }, 400), json({ error: 'Sign in first.' }, 401), json({ error: 'Not allowed' }, 403)];
    const { api } = photoApi(vi.fn(async () => replies.shift()!));
    const jpeg = new Blob(['jpeg']);

    await expect(api.uploadPhoto('c12', jpeg)).rejects.toEqual(new ApiError('Candidate #12 is not waiting'));
    await expect(api.uploadPhoto('c12', jpeg)).rejects.toEqual(new ApiError(SESSION_ERROR));
    await expect(api.photoBlob('c12', 'v1')).rejects.toEqual(new ApiError(NOT_ALLOWED));
    expect(listener).toHaveBeenCalledTimes(1); // only the 403
    stop();
  });

  it('reports a failed request as a network problem and a stalled one as a timeout', async () => {
    const { api: offline } = photoApi(vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(offline.uploadPhoto('c1', new Blob(['jpeg']))).rejects.toEqual(new ApiError(NETWORK_ERROR));

    const stalled: PhotoFetch = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    const { api: slow } = photoApi(stalled, { timeoutMs: 20 });
    await expect(slow.uploadPhoto('c1', new Blob(['jpeg']))).rejects.toEqual(new ApiError(PHOTO_TIMEOUT_ERROR));
  });

  it('calls the photo queue and photo count functions', async () => {
    const { rpc, api } = photoApi(vi.fn());
    await api.photoQueue();
    await api.photoCount();
    expect(rpc.mock.calls).toEqual([['photo_queue', undefined], ['photo_count', undefined]]);
  });
});
