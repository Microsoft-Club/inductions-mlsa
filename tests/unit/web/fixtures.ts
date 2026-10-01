// Test data shaped like the database functions' output (see src/lib/types.ts).
import type {
  BoardPanel,
  BoardSnapshot,
  Candidate,
  CandidateRecord,
  Criterion,
  CurrentInterview,
  DisplaySnapshot,
  LaneEntry,
  LastEnded,
  PhotoQueueEntry,
  Profile,
  ResultRow,
  Role,
} from '../../../src/lib/types.ts';

const reg = (number: number) => `2025${String(number).padStart(3, '0')}`;

export function lane(...people: Array<[number, string]>): LaneEntry[] {
  return people.map(([number, name], i) => ({
    candidate_id: `c${number}`,
    number,
    name,
    reg_number: reg(number),
    position: i + 1,
    skip_count: 0,
    checked_in_at: '2026-09-26T09:00:00Z',
    has_photo: true,
  }));
}

export function interview(number: number, name: string, startedAt = '2026-09-26T09:50:00Z'): CurrentInterview {
  return { interview_id: `i${number}`, candidate_id: `c${number}`, number, name, reg_number: reg(number), started_at: startedAt };
}

/** The panel's last ended interview; ready_at null means the panel is still wrapping up. */
export function ended(number: number, name: string, readyAt: string | null = '2026-09-26T09:41:00Z'): LastEnded {
  return { interview_id: `i${number}`, candidate_id: `c${number}`, number, name, ended_at: '2026-09-26T09:40:00Z', ready_at: readyAt };
}

export function boardPanel(id: string, name: string, overrides: Partial<BoardPanel> = {}): BoardPanel {
  return { id, name, is_default: false, current: null, last_ended: null, lane: [], panelists: [], ...overrides };
}

/** Panel 1 busy with #7, Panel 2 free with #12 lined up, three people in the pool. */
export function board(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    induction: { id: 'ind-1', name: 'Fall 2026', target_interview_minutes: 15, results_published: false },
    server_time: '2026-09-26T10:00:00Z',
    counts: { registered: 40, waiting: 4, interviewing: 1, interviewed: 16 },
    panels: [
      boardPanel('p1', 'Panel 1', { is_default: true, current: interview(7, 'Sara Ahmed'), panelists: [{ id: 'u1', display_name: 'Hamza' }, { id: 'u2', display_name: 'Mariam' }] }),
      boardPanel('p2', 'Panel 2', { is_default: true, lane: lane([12, 'Ali Raza']) }),
    ],
    pool: lane([20, 'Bilal Khan'], [21, 'عائشہ خان'], [22, "Zara O'Brien-Khan"]),
    form_warnings: [],
    ...overrides,
  };
}

/** The projector's view of the same moment. */
export function display(overrides: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    induction_name: 'Fall 2026',
    target_interview_minutes: 15,
    server_time: '2026-09-26T10:00:00Z',
    panels: [
      { id: 'p1', name: 'Panel 1', current: { number: 7, name: 'Sara Ahmed', started_at: '2026-09-26T09:50:00Z' }, lined_up: [] },
      { id: 'p2', name: 'Panel 2', current: null, lined_up: [{ number: 12, name: 'Ali Raza' }] },
    ],
    waiting: [
      { number: 20, name: 'Bilal Khan' },
      { number: 21, name: 'عائشہ خان' },
      { number: 22, name: "Zara O'Brien-Khan" },
    ],
    ...overrides,
  };
}

export function profile(role: Role, overrides: Partial<Profile> = {}): Profile {
  const username = role === 'queue_manager' ? 'queue' : role;
  return { id: `u-${username}`, username, display_name: `Test ${username}`, role, is_active: true, current_panel_id: null, ...overrides };
}

/** #7 Sara Ahmed's application. The LogiKal section is all blank and Marketing is missing, so both tabs hide. */
export function candidateRow(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'c7',
    number: 7,
    reg_number: '2025007',
    full_name: 'Sara Ahmed',
    email: 'sara@example.test',
    account_email: 'sara.account@example.test',
    phone: '03001234507',
    department: 'Computer Science',
    batch: 'B35',
    submitted_at: '2026-09-20T05:15:02+00:00',
    preferences: ['Dev Team', 'Marketing', '', ''],
    answers: {
      general: [
        { q: 'What motivated you to join Microsoft Club?', a: 'I like building things with others.' },
        { q: 'Tell us about something that you are proud of.', a: '' },
      ],
      dev: [{ q: 'Which programming languages or frameworks do you know?', a: 'TypeScript, Python' }],
      logikal: [{ q: 'Which parts of LogiKal interest you most?', a: '  ' }],
      lnd: [{ q: 'What excites you most about the L&D team?', a: 'Teaching first-years.' }],
    },
    status: 'interviewing',
    checked_in_at: '2026-09-26T09:00:00Z',
    decision: 'undecided',
    photo_taken_at: null,
    ...overrides,
  };
}

/** The seeded placeholder criteria (supabase/migrations/…core_schema.sql). */
export function criteriaList(): Criterion[] {
  const general = ['Communication', 'Confidence & Attitude', 'Teamwork', 'Commitment', 'Problem Solving'];
  const keys = ['communication', 'confidence_attitude', 'teamwork', 'commitment', 'problem_solving'];
  const fit = [['fit_dev', 'Dev'], ['fit_logikal', 'LogiKal'], ['fit_lnd', 'L&D'], ['fit_marketing', 'Marketing']];
  return [
    ...general.map((label, i) => ({ key: keys[i], label, category: 'general' as const, sort_order: i + 1 })),
    ...fit.map(([key, label], i) => ({ key, label, category: 'team_fit' as const, sort_order: i + 6 })),
  ];
}

export function resultRow(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    candidate_id: 'c7',
    number: 7,
    reg_number: '2025007',
    full_name: 'Sara Ahmed',
    department: 'Computer Science',
    batch: 'B35',
    preferences: ['Dev Team', 'Marketing', '', ''],
    status: 'interviewed',
    decision: 'undecided',
    panels: ['Panel 1'],
    evaluation_count: 2,
    general_avg: 3.75,
    criteria_avgs: { communication: 4, teamwork: 3.5, fit_dev: 5 },
    recommendations: { yes: 1, strong_yes: 1 },
    ...overrides,
  };
}

/** One waiting candidate on the photographer's list; no photo unless overridden. */
export function photoEntry(number: number, name: string, overrides: Partial<PhotoQueueEntry> = {}): PhotoQueueEntry {
  return { candidate_id: `c${number}`, number, name, checked_in_at: '2026-09-26T09:00:00Z', photo_taken_at: null, ...overrides };
}

export function candidateRecordFor(candidate: Candidate = candidateRow()): CandidateRecord {
  return {
    candidate: { ...candidate, created_at: '2026-09-20T05:20:00Z', updated_at: '2026-09-26T10:20:00Z' },
    interviews: [
      {
        id: 'i7',
        panel_name: 'Panel 1',
        status: 'ended',
        started_at: '2026-09-26T09:50:00Z',
        ended_at: '2026-09-26T10:06:30Z',
        messages: [
          { id: 'm1', interview_id: 'i7', author_id: 'u1', author_name: 'Hamza', body: 'Strong on teamwork.', created_at: '2026-09-26T09:55:00Z' },
        ],
        evaluations: [
          { panelist_name: 'Hamza', scores: { communication: 4, fit_dev: 5 }, recommendation: 'strong_yes', comments: 'Great fit.', submitted_at: '2026-09-26T10:07:00Z', updated_at: '2026-09-26T10:07:00Z' },
          { panelist_name: 'Mariam', scores: { teamwork: 3.5 }, recommendation: 'yes', comments: '', submitted_at: '2026-09-26T10:08:00Z', updated_at: '2026-09-26T10:08:00Z' },
        ],
      },
    ],
  };
}
