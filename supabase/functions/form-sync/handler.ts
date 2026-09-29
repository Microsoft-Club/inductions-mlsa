// The form-sync edge function's logic, kept free of Deno APIs so it can be unit tested. The Apps
// Script on the form's responses sheet POSTs each new response here as { header, values }: the
// sheet's header row and the response's row, both as displayed (so they read exactly like a CSV
// export). The shared secret stands in for a login, since Google can't sign in.
import { FORM_LAYOUT, type FormLayout } from '../_shared/formLayout.ts';
import { headerMismatches, mapRow, type HeaderMismatch, type ImportRow } from '../_shared/formRows.ts';

export type DbResult = { data: unknown; error: { message: string } | null };

export interface FormSyncDeps {
  /** FORM_SYNC_SECRET; unset or empty means form sync is off. */
  secret: string | undefined;
  /** sync_form_response(p_row): imports the row and keeps its flags as board warnings. */
  syncResponse(row: ImportRow): Promise<DbResult>;
  /** note_form_problem(p_reason): a warning on the board for a response that couldn't be read. */
  noteProblem(reason: string): Promise<DbResult>;
}

/** A response is a few kilobytes; this leaves plenty of room for long answers. */
const MAX_BODY_CHARS = 1_000_000;
const SHAPE_ERROR = 'Send one response as JSON: { "header": [...], "values": [...] } (strings, in the sheet\'s column order)';
const CATCH_UP = 'Use Import CSV to catch up.';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Compares in constant time, so response timing doesn't give the secret away. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

function readBody(text: string): { header: string[]; values: string[] } | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { header, values } = body as Record<string, unknown>;
  return isStrings(header) && isStrings(values) ? { header, values } : null;
}

function mismatchReason(mismatches: HeaderMismatch[]): string {
  const [first] = mismatches;
  const found = first.found.length > 80 ? `${first.found.slice(0, 79)}…` : first.found;
  const change = first.found === '(missing)' ? `column ${first.column} is gone` : `column ${first.column} is now "${found}"`;
  const more = mismatches.length - 1;
  const others = more === 0 ? '' : `, and ${more} more ${more === 1 ? 'change' : 'changes'}`;
  return `A form response was not imported: the form's questions no longer match the app (${change}${others}). Update the form layout in the app, then use Import CSV to catch up.`;
}

export async function handleFormSync(req: Request, deps: FormSyncDeps, layout: FormLayout = FORM_LAYOUT): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!deps.secret) return json({ error: 'Form sync is not set up (FORM_SYNC_SECRET is missing)' }, 503);
  if (!sameSecret(req.headers.get('x-form-sync-secret') ?? '', deps.secret)) return json({ error: 'Not allowed' }, 401);

  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) return json({ error: 'That response is too large' }, 413);
  const body = readBody(text);
  if (!body) return json({ error: SHAPE_ERROR }, 400);

  // Never guess which answer is which: a changed form becomes a warning on the board instead.
  const mismatches = headerMismatches(body.header, layout);
  const problem =
    mismatches.length > 0
      ? mismatchReason(mismatches)
      : body.values.length !== layout.columns.length
        ? `A form response was not imported: it had ${body.values.length} cells but the form has ${layout.columns.length} columns. ${CATCH_UP}`
        : null;
  if (problem) {
    const { error } = await deps.noteProblem(problem);
    if (error) console.error(`note_form_problem failed: ${error.message}`);
    return json({ error: problem, mismatches }, 422);
  }

  const { data, error } = await deps.syncResponse(mapRow(body.values, layout).row);
  if (error) return json({ error: error.message }, error.message === 'No active induction' ? 409 : 500);
  return json(data);
}
