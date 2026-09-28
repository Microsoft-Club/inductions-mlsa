// Local development data: seven accounts and 60 fake candidates. Safe to re-run.
import { createClient } from '@supabase/supabase-js';
import { createAccount, usernameToEmail, type Role } from '../supabase/functions/_shared/accounts.ts';
import { localEnv } from './lib/local-env.ts';

const PASSWORD = 'induction-dev';
const ACCOUNTS: Array<{ username: string; displayName: string; role: Role }> = [
  { username: 'admin', displayName: 'Admin', role: 'admin' },
  { username: 'queue', displayName: 'Queue Manager', role: 'queue_manager' },
  { username: 'photos', displayName: 'Photographer', role: 'photographer' },
  { username: 'panelist1', displayName: 'Panelist One', role: 'panelist' },
  { username: 'panelist2', displayName: 'Panelist Two', role: 'panelist' },
  { username: 'panelist3', displayName: 'Panelist Three', role: 'panelist' },
  { username: 'panelist4', displayName: 'Panelist Four', role: 'panelist' },
];

const FIRST = ['Ali', 'Ahmed', 'Hamza', 'Maimoona', 'Ayesha', 'Bilal', 'Fatima', 'Hassan', 'Zainab', 'Usman', 'Sana', 'Omar'];
const LAST = ['Khan', 'Raza', 'Malik', 'Qureshi', 'Siddiqui'];
const TEAMS = ['Dev Team', 'Logikal', 'L&Ds', 'Marketing'];
const DEPARTMENTS = ['Computer Science', 'Data Science', 'Electrical Engineering', 'Mechanical Engineering'];

function fakeRow(i: number) {
  const name = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`;
  const rotation = i % TEAMS.length;
  return {
    reg_number: String(2025100 + i),
    full_name: name,
    email: `candidate${i}@example.test`,
    account_email: `candidate${i}@example.test`,
    phone: `0300${String(i).padStart(7, '0')}`,
    department: DEPARTMENTS[i % DEPARTMENTS.length],
    batch: i % 2 === 0 ? 'B36' : 'B35',
    submitted_at: new Date(Date.UTC(2026, 8, 20, 5, 0, 0) + i * 17 * 60_000).toISOString(),
    preferences: [...TEAMS.slice(rotation), ...TEAMS.slice(0, rotation)],
    answers: {
      general: [
        { q: 'What motivated you to join Microsoft Club?', a: `Sample motivation from ${name}.` },
        { q: 'On average, how many hours per week can you realistically commit to MLSA activities, projects, and events?', a: String(4 + (i % 6)) },
      ],
      ...(i % 3 === 0 ? { dev: [{ q: 'Which programming languages or frameworks do you know?', a: 'Python, React' }] } : {}),
      ...(i % 3 === 1 ? { marketing: [{ q: 'Which design tools are you comfortable with?', a: 'Canva, Figma' }] } : {}),
      ...(i % 3 === 2 ? { lnd: [{ q: 'What excites you most about the Learning & Development (L&D) team?', a: 'Teaching others.' }] } : {}),
    },
  };
}

const env = localEnv();
const service = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

for (const account of ACCOUNTS) {
  const result = await createAccount(service, { ...account, password: PASSWORD });
  if (!result.ok && result.error !== 'Username already taken') throw new Error(result.error);
  console.log(`${result.ok ? 'created' : 'exists '}  ${account.username} (${account.role})`);
}

const admin = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const signIn = await admin.auth.signInWithPassword({ email: usernameToEmail('admin'), password: PASSWORD });
if (signIn.error) throw signIn.error;

const rows = Array.from({ length: 60 }, (_, i) => fakeRow(i + 1));
const { data, error } = await admin.rpc('import_candidates', { p_rows: rows });
if (error) throw error;
console.log(`candidates: ${data.added} added, ${data.updated} updated, ${data.flagged.length} flagged`);
console.log(`\nLog in as ${ACCOUNTS.map((a) => a.username).join(', ')} with password "${PASSWORD}"`);
