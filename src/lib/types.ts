// Shapes of what the database functions return (see supabase/migrations). Kept by hand: every
// screen reads through src/lib/api.ts, and tests/integration/web-api.test.ts checks these shapes
// against the real functions.

export type Role = 'admin' | 'queue_manager' | 'panelist';
export type CandidateStatus = 'registered' | 'waiting' | 'interviewing' | 'interviewed';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  current_panel_id: string | null;
}

/** One person in the waiting pool or in a panel's lane (board_snapshot → lane_json). */
export interface LaneEntry {
  candidate_id: string;
  number: number;
  name: string;
  reg_number: string;
  position: number;
  skip_count: number;
  checked_in_at: string | null;
}

export interface CurrentInterview {
  interview_id: string;
  candidate_id: string;
  number: number;
  name: string;
  reg_number: string;
  started_at: string;
}

export interface LastEnded {
  interview_id: string;
  candidate_id: string;
  number: number;
  name: string;
  ended_at: string;
}

export interface BoardPanel {
  id: string;
  name: string;
  is_default: boolean;
  current: CurrentInterview | null;
  /** The interview "Reopen" applies to; null while the panel is busy or has had no interview. */
  last_ended: LastEnded | null;
  lane: LaneEntry[];
  panelists: { id: string; display_name: string }[];
}

export interface BoardSnapshot {
  induction: { id: string; name: string; target_interview_minutes: number; results_published: boolean };
  server_time: string;
  counts: Record<CandidateStatus, number>;
  panels: BoardPanel[];
  pool: LaneEntry[];
}

export interface DisplayPerson {
  number: number;
  name: string;
}

export interface DisplayPanel {
  id: string;
  name: string;
  current: (DisplayPerson & { started_at: string }) | null;
  /** Up to 3 people lined up for this panel. */
  lined_up: DisplayPerson[];
}

export interface DisplaySnapshot {
  induction_name: string;
  target_interview_minutes: number;
  server_time: string;
  panels: DisplayPanel[];
  /** The first 8 people in the waiting pool. */
  waiting: DisplayPerson[];
}

export interface CandidateSummary {
  id: string;
  number: number;
  full_name: string;
  reg_number: string;
  status: CandidateStatus;
}

export type AnswerSection = 'general' | 'dev' | 'logikal' | 'lnd' | 'marketing';

export interface Answer {
  q: string;
  a: string;
}

/** One form response, as import_candidates(p_rows) expects it. */
export interface ImportRow {
  /** ISO 8601 with offset, or null when the timestamp couldn't be read (the server then uses now()). */
  submitted_at: string | null;
  reg_number: string;
  full_name: string;
  email: string;
  account_email: string;
  phone: string;
  department: string;
  batch: string;
  /** Team preferences 1–4 in rank order; '' when a rank was left blank. */
  preferences: string[];
  answers: Record<AnswerSection, Answer[]>;
}

export interface ImportFlag {
  reg_number: string;
  name: string;
  reason: string;
}

export interface ImportResult {
  added: number;
  updated: number;
  flagged: ImportFlag[];
}

// ---- Panelist, admin and results screens (Plan 3) ----

export type Decision = 'undecided' | 'selected' | 'not_selected';
export type Recommendation = 'strong_yes' | 'yes' | 'maybe' | 'no';
export type InterviewStatus = 'in_progress' | 'ended' | 'cancelled';

/** A full candidates row, as panelists and admins read it. */
export interface Candidate {
  id: string;
  number: number;
  reg_number: string;
  full_name: string;
  email: string;
  account_email: string;
  phone: string;
  department: string;
  batch: string;
  submitted_at: string;
  preferences: string[];
  /** Sections the form had; an import may leave a section out. */
  answers: Partial<Record<AnswerSection, Answer[]>>;
  status: CandidateStatus;
  checked_in_at: string | null;
  decision: Decision;
}

/** One interview on a panel, newest first (the panelist's current and recent interviews). */
export interface PanelInterview {
  id: string;
  status: InterviewStatus;
  started_at: string;
  ended_at: string | null;
  candidate: { id: string; number: number; full_name: string };
}

export interface ChatMessage {
  id: string;
  interview_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface Criterion {
  key: string;
  label: string;
  category: 'general' | 'team_fit';
  sort_order: number;
}

/** Scores by criterion key, 1–5. A missing key means N/A or not scored. */
export type Scores = Record<string, number>;

export interface MyEvaluation {
  interview_id: string;
  scores: Scores;
  recommendation: Recommendation;
  comments: string;
  updated_at: string;
}

export type Account = Profile;

export interface InductionSettings {
  id: string;
  name: string;
  target_interview_minutes: number;
  results_published: boolean;
}

/** One row of results_table(). Averages are null when nobody gave a score. */
export interface ResultRow {
  candidate_id: string;
  number: number;
  reg_number: string;
  full_name: string;
  department: string;
  batch: string;
  preferences: string[];
  status: CandidateStatus;
  decision: Decision;
  evaluation_count: number;
  general_avg: number | null;
  criteria_avgs: Record<string, number>;
  recommendations: Partial<Record<Recommendation, number>>;
}

export interface RecordEvaluation {
  panelist_name: string;
  scores: Scores;
  recommendation: Recommendation;
  comments: string;
  submitted_at: string;
  updated_at: string;
}

export interface RecordInterview {
  id: string;
  panel_name: string;
  status: InterviewStatus;
  started_at: string;
  ended_at: string | null;
  messages: ChatMessage[];
  evaluations: RecordEvaluation[];
}

/** candidate_record(): everything about one candidate, for admins. */
export interface CandidateRecord {
  candidate: Candidate & { created_at: string; updated_at: string };
  interviews: RecordInterview[];
}

/** One row of evaluations_export(). */
export interface EvaluationExportRow {
  number: number;
  reg_number: string;
  full_name: string;
  panel: string;
  panelist: string;
  scores: Scores;
  recommendation: Recommendation;
  comments: string;
  submitted_at: string;
}

export interface PublishedResult {
  full_name: string;
  reg_number: string;
}
