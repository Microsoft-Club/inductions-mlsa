// Shapes of what the database functions return (see supabase/migrations). Kept by hand: every
// screen reads through src/lib/api.ts, and tests/integration/web-api.test.ts checks these shapes
// against the real functions.
import type { Answer, AnswerSection, ImportRow } from '../../supabase/functions/_shared/formRows.ts';

export type Role = 'admin' | 'queue_manager' | 'panelist' | 'photographer';
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
  /** False shows the queue manager's camera icon and the "no photo yet" question at Send in. */
  has_photo: boolean;
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

/** Something the Google Form sync wants a person to check (board_snapshot → form_warnings). */
export interface FormWarning {
  id: string;
  /** '' when the response had none, or when the warning is about the form itself. */
  reg_number: string;
  name: string;
  reason: string;
  created_at: string;
}

export interface BoardSnapshot {
  induction: { id: string; name: string; target_interview_minutes: number; results_published: boolean };
  server_time: string;
  counts: Record<CandidateStatus, number>;
  panels: BoardPanel[];
  pool: LaneEntry[];
  /** Newest first; always empty for panelists. */
  form_warnings: FormWarning[];
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

/** One waiting candidate on the photographer's list (photo_queue()). */
export interface PhotoQueueEntry {
  candidate_id: string;
  number: number;
  name: string;
  checked_in_at: string | null;
  photo_taken_at: string | null;
}

// Form responses: shared with the form-sync edge function (supabase/functions/_shared/formRows.ts).
export type { Answer, AnswerSection, ImportRow };

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
  /** When the photo on file was taken (also its version); null = no photo. */
  photo_taken_at: string | null;
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

/** One of the panelist's own evaluations with its interview, for their history (any panel). */
export interface MyEvaluationWithInterview extends MyEvaluation {
  interview: PanelInterview & { panel: { name: string } };
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
  /** The panels that interviewed them, first interview first (cancelled send-ins left out). */
  panels: string[];
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
  /** First submitted. */
  submitted_at: string;
  /** Last changed (panelists can update until results are published). */
  updated_at: string;
}

export interface PublishedResult {
  full_name: string;
  reg_number: string;
}
