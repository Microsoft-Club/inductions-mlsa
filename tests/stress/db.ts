// SQL against the LOCAL Supabase database, for setting up and checking what the stress tests do.
// It runs psql inside the local database container, so it can never reach a hosted project.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
if (!projectId) throw new Error('No project_id in supabase/config.toml');
const container = `supabase_db_${projectId}`;

/** Runs SQL as postgres and returns the rows as text: one row per line, columns separated by "|". */
export function sql(query: string): string {
  try {
    return execSync(`docker exec -i ${container} psql -U postgres -d postgres -At -F "|" -v ON_ERROR_STOP=1`, { input: query, encoding: 'utf8' }).trim();
  } catch (e) {
    throw new Error(`SQL failed in ${container} (is the local stack running? npm run db:start): ${(e as Error).message}`);
  }
}
