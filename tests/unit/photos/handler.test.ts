import { describe, expect, it, vi } from 'vitest';
import type { PhotoBucket } from '../../../server/photos/bucket.ts';
import { handlePhotoRequest, type PhotoEnv } from '../../../server/photos/handler.ts';
import { MAX_PHOTO_BYTES } from '../../../server/photos/limits.ts';

const ID = '11111111-2222-4333-8444-555555555555';
const KEY = `ind-1/${ID}.jpg`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const TAKEN_AT = '2026-09-27T10:00:00.123456+00:00';

/** An in-memory bucket that keeps a log of what happened, in order. */
function memoryBucket(initial: Array<[string, Uint8Array<ArrayBuffer>]> = []) {
  const files = new Map(initial);
  const log: string[] = [];
  const bucket = {
    put: vi.fn(async (key: string, value: Uint8Array<ArrayBuffer>) => {
      log.push(`put ${key}`);
      files.set(key, value);
    }),
    get: vi.fn(async (key: string) => {
      const value = files.get(key);
      return value ? { body: new Blob([value]).stream() } : null;
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) {
        log.push(`delete ${key}`);
        files.delete(key);
      }
    }),
    list: vi.fn(async ({ limit = 1000, cursor }: { limit?: number; cursor?: string } = {}) => {
      const keys = [...files.keys()].sort().filter((key) => !cursor || key > cursor);
      const page = keys.slice(0, limit);
      const truncated = keys.length > page.length;
      return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? page.at(-1) : undefined };
    }),
  } satisfies PhotoBucket;
  return { bucket, files, log };
}

type Reply = { status?: number; body?: unknown };

/** Answers `/rest/v1/rpc/<fn>` like PostgREST from a table of replies, and remembers every call. */
function fakeSupabase(replies: Record<string, Reply>) {
  const calls: Array<{ url: string; fn: string; args: unknown; authorization: string | null; apikey: string | null }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const fn = url.split('/rpc/')[1];
    const headers = new Headers(init.headers);
    calls.push({ url, fn, args: JSON.parse(String(init.body)), authorization: headers.get('Authorization'), apikey: headers.get('apikey') });
    const reply = replies[fn] ?? { status: 404, body: { message: `no fake for ${fn}` } };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
  return { fetchImpl, calls, fns: () => calls.map((c) => c.fn) };
}

const envWith = (bucket: PhotoBucket): PhotoEnv => ({
  PHOTOS: bucket,
  VITE_SUPABASE_URL: 'https://db.test',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
});

function request(method: string, path: string, body?: Uint8Array<ArrayBuffer>, token: string | null = 'user-token') {
  return new Request(`https://site.test${path}`, { method, body, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

describe('PUT /api/photos/:candidateId', () => {
  it('asks the database, saves the file, then records it', async () => {
    const { bucket, files } = memoryBucket();
    const db = fakeSupabase({ authorize_photo_upload: { body: KEY }, record_photo: { body: TAKEN_AT } });

    const response = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ photo_taken_at: TAKEN_AT });
    expect(db.fns()).toEqual(['authorize_photo_upload', 'record_photo']);
    expect(db.calls[0]).toEqual({
      url: 'https://db.test/rest/v1/rpc/authorize_photo_upload',
      fn: 'authorize_photo_upload',
      args: { p_candidate_id: ID },
      authorization: 'Bearer user-token',
      apikey: 'anon-key',
    });
    expect(bucket.put).toHaveBeenCalledWith(KEY, JPEG, { httpMetadata: { contentType: 'image/jpeg' } });
    expect(files.get(KEY)).toEqual(JPEG);
  });

  it('does not record a photo whose file could not be saved', async () => {
    const { bucket } = memoryBucket();
    bucket.put.mockRejectedValueOnce(new Error('R2 is down'));
    const db = fakeSupabase({ authorize_photo_upload: { body: KEY }, record_photo: { body: TAKEN_AT } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Couldn't save the photo. Try again." });
    expect(db.fns()).toEqual(['authorize_photo_upload']);
    expect(spy).toHaveBeenCalledWith('photo API: saving the file failed', expect.any(Error));
    spy.mockRestore();
  });

  it('returns 502 when bucket.put times out (never resolves)', async () => {
    const { bucket } = memoryBucket();
    bucket.put.mockImplementation(() => new Promise(() => {})); // Never resolves
    const db = fakeSupabase({ authorize_photo_upload: { body: KEY }, record_photo: { body: TAKEN_AT } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Pass a short 100ms timeout so we don't wait 10 seconds in the test
    const response = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), db.fetchImpl, 100);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Couldn't save the photo. Try again." });
    expect(db.fns()).toEqual(['authorize_photo_upload']);
    expect(spy).toHaveBeenCalledWith('photo API: saving the file failed', expect.any(Error));
    spy.mockRestore();
  });

  it('refuses a declared size over 1 MB before asking the database', async () => {
    const { bucket } = memoryBucket();
    const db = fakeSupabase({});
    const big = request('PUT', `/api/photos/${ID}`, JPEG);
    Object.defineProperty(big, 'headers', {
      value: new Headers({ Authorization: 'Bearer user-token', 'Content-Length': String(MAX_PHOTO_BYTES + 1) }),
    });

    const response = await handlePhotoRequest(big, envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(413);
    expect(db.fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a body over 1 MB and anything that is not a JPEG, without saving or recording', async () => {
    const { bucket } = memoryBucket();
    const db = fakeSupabase({ authorize_photo_upload: { body: KEY }, record_photo: { body: TAKEN_AT } });
    const tooBig = new Uint8Array(MAX_PHOTO_BYTES + 1);
    tooBig.set([0xff, 0xd8, 0xff]);

    const big = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, tooBig), envWith(bucket), db.fetchImpl);
    const png = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, new Uint8Array([0x89, 0x50, 0x4e, 0x47])), envWith(bucket), db.fetchImpl);

    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'The photo is too large (over 1 MB).' });
    expect(png.status).toBe(415);
    expect(await png.json()).toEqual({ error: 'The photo must be a JPEG.' });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(db.fns()).toEqual(['authorize_photo_upload', 'authorize_photo_upload']);
  });

  it("passes the database's refusal through", async () => {
    const { bucket } = memoryBucket();
    const db = fakeSupabase({ authorize_photo_upload: { status: 400, body: { code: 'P0001', message: 'Candidate #12 is not waiting' } } });

    const response = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Candidate #12 is not waiting' });
    expect(bucket.put).not.toHaveBeenCalled();
  });
});

describe('logins, permissions and routes', () => {
  it('maps an expired login to 401 and a role refusal to 403', async () => {
    const { bucket } = memoryBucket();
    const expired = fakeSupabase({ authorize_photo_upload: { status: 401, body: { code: 'PGRST303', message: 'JWT expired' } } });
    const refused = fakeSupabase({ authorize_photo_upload: { status: 403, body: { code: '42501', message: 'Not allowed' } } });

    const a = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), expired.fetchImpl);
    const b = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), refused.fetchImpl);

    expect([a.status, await a.json()]).toEqual([401, { error: 'Your login has expired. Sign in again.' }]);
    expect([b.status, await b.json()]).toEqual([403, { error: 'Not allowed' }]);
  });

  it('reports an unreachable database as 502', async () => {
    const { bucket } = memoryBucket();
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handlePhotoRequest(request('GET', `/api/photos/${ID}`), envWith(bucket), offline);

    expect([response.status, await response.json()]).toEqual([502, { error: "Can't reach the database. Try again." }]);
    expect(spy).toHaveBeenCalledWith('photo API: database call failed', expect.any(TypeError));
    spy.mockRestore();
  });

  it('asks for a login before calling the database', async () => {
    const db = fakeSupabase({});
    const response = await handlePhotoRequest(request('GET', `/api/photos/${ID}`, undefined, null), envWith(memoryBucket().bucket), db.fetchImpl);
    expect([response.status, await response.json()]).toEqual([401, { error: 'Sign in first.' }]);
    expect(db.fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses bad ids, wrong methods and other paths', async () => {
    const env = envWith(memoryBucket().bucket);
    const db = fakeSupabase({});

    const badId = await handlePhotoRequest(request('GET', '/api/photos/not-a-uuid'), env, db.fetchImpl);
    const post = await handlePhotoRequest(request('POST', `/api/photos/${ID}`, JPEG), env, db.fetchImpl);
    const getAll = await handlePhotoRequest(request('GET', '/api/photos'), env, db.fetchImpl);
    const other = await handlePhotoRequest(request('GET', '/api/other'), env, db.fetchImpl);

    expect([badId.status, await badId.json()]).toEqual([400, { error: 'Unknown candidate' }]);
    expect([post.status, post.headers.get('Allow')]).toEqual([405, 'GET, PUT']);
    expect([getAll.status, getAll.headers.get('Allow')]).toEqual([405, 'DELETE']);
    expect(other.status).toBe(404);
    expect(db.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('GET /api/photos/:candidateId', () => {
  it('sends the photo, never to be cached by the browser', async () => {
    const { bucket } = memoryBucket([[KEY, JPEG]]);
    const db = fakeSupabase({ authorize_photo_view: { body: KEY } });

    const response = await handlePhotoRequest(request('GET', `/api/photos/${ID}?v=${encodeURIComponent(TAKEN_AT)}`), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(db.calls[0].args).toEqual({ p_candidate_id: ID });
  });

  it('answers 404 when there is no photo, or the file is missing', async () => {
    const { bucket } = memoryBucket();
    const none = fakeSupabase({ authorize_photo_view: { body: null } });
    const missing = fakeSupabase({ authorize_photo_view: { body: KEY } });

    const a = await handlePhotoRequest(request('GET', `/api/photos/${ID}`), envWith(bucket), none.fetchImpl);
    const b = await handlePhotoRequest(request('GET', `/api/photos/${ID}`), envWith(bucket), missing.fetchImpl);

    expect([a.status, await a.json()]).toEqual([404, { error: 'No photo' }]);
    expect([b.status, await b.json()]).toEqual([404, { error: 'No photo' }]);
    expect(bucket.get).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/photos', () => {
  it('deletes every file page by page, then clears the records', async () => {
    const { bucket, files } = memoryBucket(Array.from({ length: 2500 }, (_, i) => [`ind-1/${String(i).padStart(4, '0')}.jpg`, JPEG]));
    const db = fakeSupabase({ authorize_photo_purge: { body: null }, clear_photos: { body: 2500 } });

    const response = await handlePhotoRequest(request('DELETE', '/api/photos'), envWith(bucket), db.fetchImpl);

    expect([response.status, await response.json()]).toEqual([200, { deleted: 2500 }]);
    expect(files.size).toBe(0);
    expect(bucket.list).toHaveBeenCalledTimes(3);
    for (const [keys] of bucket.delete.mock.calls) expect((keys as string[]).length).toBeLessThanOrEqual(1000);
    expect(db.fns()).toEqual(['authorize_photo_purge', 'clear_photos']);
  });

  it('is harmless to run again', async () => {
    const { bucket } = memoryBucket();
    const db = fakeSupabase({ authorize_photo_purge: { body: null }, clear_photos: { body: 0 } });

    const response = await handlePhotoRequest(request('DELETE', '/api/photos'), envWith(bucket), db.fetchImpl);

    expect([response.status, await response.json()]).toEqual([200, { deleted: 0 }]);
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('refuses non-admins without touching the bucket', async () => {
    const { bucket } = memoryBucket([[KEY, JPEG]]);
    const db = fakeSupabase({ authorize_photo_purge: { status: 403, body: { code: '42501', message: 'Not allowed' } } });

    const response = await handlePhotoRequest(request('DELETE', '/api/photos'), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(403);
    expect(bucket.list).not.toHaveBeenCalled();
  });

  it('keeps the records when a file could not be deleted, so running it again finishes the job', async () => {
    const { bucket } = memoryBucket([[KEY, JPEG]]);
    bucket.delete.mockRejectedValueOnce(new Error('R2 is down'));
    const db = fakeSupabase({ authorize_photo_purge: { body: null }, clear_photos: { body: 1 } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handlePhotoRequest(request('DELETE', '/api/photos'), envWith(bucket), db.fetchImpl);

    expect([response.status, await response.json()]).toEqual([502, { error: "Couldn't delete every photo. Try again." }]);
    expect(db.fns()).toEqual(['authorize_photo_purge']);
    expect(spy).toHaveBeenCalledWith('photo API: deleting files failed', expect.any(Error));
    spy.mockRestore();
  });
});
