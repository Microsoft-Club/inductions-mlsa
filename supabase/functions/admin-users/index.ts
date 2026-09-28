// Admin-only account management: create accounts, reset passwords, disable/enable, change roles
// and delete accounts that have no history. The service-role key never leaves this function.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createAccount } from '../_shared/accounts.ts';
import { deleteRefusal, validateCommand } from './validate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Supabase has no "disabled" flag; a very long ban is the standard way to block sign-in.
const BAN_FOREVER = '876000h';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller.user) return json({ error: 'Not signed in' }, 401);

  const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', caller.user.id).maybeSingle();
  if (!me || me.role !== 'admin' || !me.is_active) return json({ error: 'Not allowed' }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Request body must be JSON' }, 400);
  }
  const parsed = validateCommand(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const cmd = parsed.command;

  switch (cmd.action) {
    case 'create': {
      const result = await createAccount(admin, cmd);
      return result.ok ? json({ user_id: result.userId }) : json({ error: result.error }, 400);
    }
    case 'reset_password': {
      const { error } = await admin.auth.admin.updateUserById(cmd.userId, { password: cmd.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'set_active': {
      if (!cmd.active && cmd.userId === caller.user.id) {
        return json({ error: 'You cannot disable your own account' }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(cmd.userId, {
        ban_duration: cmd.active ? 'none' : BAN_FOREVER,
      });
      if (error) return json({ error: error.message }, 400);
      const { error: profileError } = await admin.from('profiles').update({ is_active: cmd.active }).eq('id', cmd.userId);
      if (profileError) return json({ error: profileError.message }, 400);
      return json({ ok: true });
    }
    case 'set_role': {
      // Admins can't change their own role, so there is always at least one admin.
      if (cmd.userId === caller.user.id) return json({ error: 'You cannot change your own role' }, 400);
      // A panelist who becomes something else should no longer show as present in a panel.
      const { data, error } = await admin
        .from('profiles')
        .update({ role: cmd.role, current_panel_id: null })
        .eq('id', cmd.userId)
        .select('id');
      if (error) return json({ error: error.message }, 400);
      if (!data || data.length === 0) return json({ error: 'Account not found' }, 404);
      return json({ ok: true });
    }
    case 'delete': {
      if (cmd.userId === caller.user.id) return json({ error: 'You cannot delete your own account' }, 400);
      const { data: target } = await admin.from('profiles').select('display_name').eq('id', cmd.userId).maybeSingle();
      if (!target) return json({ error: 'Account not found' }, 404);
      const [evaluations, messages] = await Promise.all([
        admin.from('evaluations').select('id', { count: 'exact', head: true }).eq('panelist_id', cmd.userId),
        admin.from('messages').select('id', { count: 'exact', head: true }).eq('author_id', cmd.userId),
      ]);
      const countError = evaluations.error ?? messages.error;
      if (countError) return json({ error: countError.message }, 400);
      const refusal = deleteRefusal(target.display_name, evaluations.count ?? 0, messages.count ?? 0);
      if (refusal) return json({ error: refusal }, 400);
      // Deleting the login deletes the profile with it; mentions elsewhere (who started an interview,
      // who took a photo) become blank. The database still refuses if history appeared meanwhile.
      const { error } = await admin.auth.admin.deleteUser(cmd.userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
  }
});
