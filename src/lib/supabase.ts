import { createClient } from '@supabase/supabase-js';
import { readEnv } from './env.ts';

const env = readEnv(import.meta.env);

/**
 * The one browser client. Staff sessions persist in localStorage; the projector never signs in.
 * A dead connection is only noticed when a heartbeat goes unanswered, so heartbeats every 10 s (the
 * default is 25 s) show "Reconnecting…" within 10–20 s on Wi-Fi that stays up but carries nothing.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  realtime: { heartbeatIntervalMs: 10_000 },
});
