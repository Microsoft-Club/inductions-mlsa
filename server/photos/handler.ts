// The photo API (spec §7). Cloudflare Pages runs it for /api/photos (functions/api/photos/[[path]].ts),
// the Vite dev server runs it against a local folder, and the tests call it directly.
import type { PhotoBucket } from './bucket.ts';
import { callRpc, PhotoError, type FetchLike, type SupabaseEnv } from './gate.ts';
import { MAX_PHOTO_BYTES } from './limits.ts';

export interface PhotoEnv extends SupabaseEnv {
  PHOTOS: PhotoBucket;
}

type Rpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;

const ROUTE = /^\/api\/photos(?:\/([^/]*))?\/?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOO_LARGE = 'The photo is too large (over 1 MB).';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function bearer(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '');
  return match ? match[1] : null;
}

const isJpeg = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export async function handlePhotoRequest(
  request: Request,
  env: PhotoEnv,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<Response> {
  const match = ROUTE.exec(new URL(request.url).pathname);
  if (!match) return json(404, { error: 'Not found' });
  const candidateId = match[1] || null;
  const allowed = candidateId ? ['GET', 'PUT'] : ['DELETE'];
  if (!allowed.includes(request.method)) return json(405, { error: 'Method not allowed' }, { Allow: allowed.join(', ') });
  if (candidateId && !UUID.test(candidateId)) return json(400, { error: 'Unknown candidate' });
  const token = bearer(request);
  if (!token) return json(401, { error: 'Sign in first.' });

  const rpc: Rpc = (fn, args = {}) => callRpc(env, token, fn, args, fetchImpl);
  try {
    if (!candidateId) return await deleteAll(env.PHOTOS, rpc);
    if (request.method === 'GET') return await view(env.PHOTOS, rpc, candidateId);
    return await upload(request, env.PHOTOS, rpc, candidateId);
  } catch (e) {
    if (e instanceof PhotoError) return json(e.status, { error: e.message });
    return json(502, { error: 'Something went wrong. Try again.' });
  }
}

/** Save first, record second: the database never claims a photo whose file isn't there. */
async function upload(request: Request, bucket: PhotoBucket, rpc: Rpc, candidateId: string): Promise<Response> {
  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_PHOTO_BYTES) return json(413, { error: TOO_LARGE });
  const key = await rpc<string>('authorize_photo_upload', { p_candidate_id: candidateId });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_PHOTO_BYTES) return json(413, { error: TOO_LARGE });
  if (!isJpeg(bytes)) return json(415, { error: 'The photo must be a JPEG.' });
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  } catch {
    throw new PhotoError(502, "Couldn't save the photo. Try again.");
  }
  const takenAt = await rpc<string>('record_photo', { p_candidate_id: candidateId });
  return json(200, { photo_taken_at: takenAt });
}

async function view(bucket: PhotoBucket, rpc: Rpc, candidateId: string): Promise<Response> {
  const key = await rpc<string | null>('authorize_photo_view', { p_candidate_id: candidateId });
  if (!key) return json(404, { error: 'No photo' });
  let object: { body: ReadableStream } | null;
  try {
    object = await bucket.get(key);
  } catch {
    throw new PhotoError(502, "Couldn't load the photo. Try again.");
  }
  if (!object) return json(404, { error: 'No photo' });
  return new Response(object.body, {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** Files first, records second, so an interrupted run leaves records that point at deleted files, and running it again finishes the job. */
async function deleteAll(bucket: PhotoBucket, rpc: Rpc): Promise<Response> {
  await rpc<null>('authorize_photo_purge');
  try {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ limit: 1000, cursor });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) await bucket.delete(keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch {
    throw new PhotoError(502, "Couldn't delete every photo. Try again.");
  }
  const cleared = await rpc<number>('clear_photos');
  return json(200, { deleted: cleared });
}
