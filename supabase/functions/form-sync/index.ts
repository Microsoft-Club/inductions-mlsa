// Receives each new Google Form response from the Apps Script on the form's responses sheet (see
// docs/google-form-sync.md) and imports it. Deployed with verify_jwt off: Google has no Supabase
// login, so the FORM_SYNC_SECRET header is the check. The service-role key never leaves this function.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleFormSync } from './handler.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req) =>
  handleFormSync(req, {
    secret: Deno.env.get('FORM_SYNC_SECRET'),
    syncResponse: async (row) => await db.rpc('sync_form_response', { p_row: row }),
    noteProblem: async (reason) => await db.rpc('note_form_problem', { p_reason: reason }),
  }),
);
