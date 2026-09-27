// Asks the database, as the signed-in user, whether a photo request is allowed. Supabase checks the
// user's token and the role rules when it runs the function; this file never reads the token itself.

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A refusal with the HTTP status and message the photo API answers with. */
export class PhotoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SupabaseEnv {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
}

export const TIMEOUT_MS = 10_000;

/** Calls one database function with the user's own token (PostgREST RPC) and returns its result. */
export async function callRpc<T>(env: SupabaseEnv, token: string, fn: string, args: Record<string, unknown>, fetchImpl: FetchLike): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error('photo API: database call failed', e);
    throw new PhotoError(502, "Can't reach the database. Try again.");
  }
  const text = await response.text().catch(() => '');
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (response.ok) return body as T;
  const error = (body ?? {}) as { code?: string; message?: string };
  if (response.status === 401) throw new PhotoError(401, 'Your login has expired. Sign in again.');
  if (response.status === 403 || error.code === '42501') throw new PhotoError(403, 'Not allowed');
  if (response.status >= 500) throw new PhotoError(502, "The database couldn't answer. Try again.");
  throw new PhotoError(400, error.message?.trim() || 'Refused');
}
