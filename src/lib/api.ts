import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { AdminUsersCommand } from '../../supabase/functions/admin-users/validate.ts';
import { notAllowed } from './notAllowed.ts';
import { broadcastSubscriber, type Subscribe } from './realtime.ts';
import type {
  Account,
  BoardSnapshot,
  Candidate,
  CandidateRecord,
  CandidateSummary,
  ChatMessage,
  Criterion,
  Decision,
  DisplaySnapshot,
  EvaluationExportRow,
  ImportResult,
  ImportRow,
  InductionSettings,
  MyEvaluationWithInterview,
  PanelInterview,
  PublishedResult,
  Recommendation,
  ResultRow,
  Scores,
} from './types.ts';

const CANDIDATE_COLUMNS =
  'id, number, reg_number, full_name, email, account_email, phone, department, batch, submitted_at, preferences, answers, status, checked_in_at, decision';

export const NETWORK_ERROR = "Can't reach the server. Check the connection and try again.";
export const TIMEOUT_ERROR = 'The server took too long to answer. Check the board before trying again.';
export const NOT_ALLOWED = 'Not allowed';

/** An action or read failed; `message` is safe to show (usually the database's own short message). */
export class ApiError extends Error {}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong';
}

/** Turns a PostgREST/Postgres error into the message a person should see. */
export function friendlyMessage(error: { message?: string; code?: string }, status?: number): string {
  if (error.code === '42501') return NOT_ALLOWED; // require_role() and RLS both use this code
  if (status === 0 || /failed to fetch|fetch failed|networkerror/i.test(error.message ?? '')) return NETWORK_ERROR;
  return error.message?.trim() || 'Something went wrong';
}

/** Every call the screens make. One object per client; its methods are stable for React deps. */
export interface Api {
  boardSnapshot(): Promise<BoardSnapshot>;
  /** null for a wrong or regenerated projector key. */
  displaySnapshot(key: string): Promise<DisplaySnapshot | null>;
  serverNow(): Promise<string>;
  listCandidates(inductionId: string): Promise<CandidateSummary[]>;
  getDisplayKey(): Promise<string>;
  checkIn(candidateId: string): Promise<void>;
  undoCheckIn(candidateId: string): Promise<void>;
  /** panelId null = the waiting pool; position null = end of the lane. */
  moveCandidate(candidateId: string, panelId: string | null, position: number | null): Promise<void>;
  skipCandidate(candidateId: string): Promise<void>;
  /** Returns the new interview's id. */
  sendIn(candidateId: string, panelId: string): Promise<string>;
  undoSendIn(interviewId: string): Promise<void>;
  endInterview(interviewId: string): Promise<void>;
  reopenInterview(interviewId: string): Promise<void>;
  /** Returns the new panel's id. */
  addPanel(): Promise<string>;
  deletePanel(panelId: string): Promise<void>;
  importCandidates(rows: ImportRow[]): Promise<ImportResult>;
  subscribeBoard(): Subscribe;
  subscribeDisplay(key: string): Subscribe;

  // Panelists (and admins on /panel)
  /** null = not sitting in any panel. */
  setMyPanel(panelId: string | null): Promise<void>;
  candidate(candidateId: string): Promise<Candidate>;
  /** The panel's interviews, newest first (cancelled ones left out). */
  panelInterviews(panelId: string): Promise<PanelInterview[]>;
  criteria(inductionId: string): Promise<Criterion[]>;
  interviewMessages(interviewId: string): Promise<ChatMessage[]>;
  /** `id` comes from the browser so a retry after a failed send can't post twice. */
  postMessage(interviewId: string, body: string, id: string): Promise<ChatMessage>;
  evaluationCount(interviewId: string): Promise<number>;
  /**
   * This person's own evaluations in the induction, with their interviews (cancelled ones left out).
   * Admins can read everyone's, hence the explicit user id.
   */
  myEvaluations(userId: string, inductionId: string): Promise<MyEvaluationWithInterview[]>;
  submitEvaluation(interviewId: string, scores: Scores, recommendation: Recommendation, comments: string): Promise<void>;
  subscribeInterview(interviewId: string): Subscribe;

  // Admins
  listAccounts(): Promise<Account[]>;
  /** Create, reset a password, disable or enable, through the admin-users edge function. */
  manageAccount(command: AdminUsersCommand): Promise<void>;
  induction(): Promise<InductionSettings>;
  updateSettings(name: string, targetMinutes: number): Promise<void>;
  /** Returns the new projector key; old links stop working at once. */
  regenerateDisplayKey(): Promise<string>;
  resultsTable(): Promise<ResultRow[]>;
  candidateRecord(candidateId: string): Promise<CandidateRecord>;
  evaluationsExport(): Promise<EvaluationExportRow[]>;
  setDecision(candidateId: string, decision: Decision): Promise<void>;
  setResultsPublished(published: boolean): Promise<void>;

  // Anyone
  publishedResults(): Promise<PublishedResult[]>;
}

export interface ApiOptions {
  /** Give up on a call after this long, so one stalled request can't hold up every later reload. */
  timeoutMs?: number;
  /** import_candidates handles hundreds of rows in one transaction; it gets longer. */
  importTimeoutMs?: number;
}

type QueryResponse = { data: unknown; error: { message?: string; code?: string } | null; status: number };

export function createApi(client: SupabaseClient, { timeoutMs = 15_000, importTimeoutMs = 60_000 }: ApiOptions = {}): Api {
  function fail(error: { message?: string; code?: string }, status?: number): ApiError {
    const message = friendlyMessage(error, status);
    if (message === NOT_ALLOWED) notAllowed.emit();
    return new ApiError(message);
  }

  /** Runs one query with a deadline. An action that times out may still have gone through, hence the message. */
  async function send<T>(query: (signal: AbortSignal) => PromiseLike<QueryResponse>, limitMs = timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limitMs);
    let response: QueryResponse;
    try {
      response = await query(controller.signal);
    } catch {
      throw new ApiError(controller.signal.aborted ? TIMEOUT_ERROR : NETWORK_ERROR);
    } finally {
      clearTimeout(timer);
    }
    if (controller.signal.aborted) throw new ApiError(TIMEOUT_ERROR);
    if (response.error) throw fail(response.error, response.status);
    return response.data as T;
  }

  const rpc = <T,>(fn: string, args?: Record<string, unknown>, limitMs?: number) =>
    send<T>((signal) => client.rpc(fn, args).abortSignal(signal), limitMs);

  return {
    boardSnapshot: () => rpc<BoardSnapshot>('board_snapshot'),
    displaySnapshot: (key) => rpc<DisplaySnapshot | null>('display_snapshot', { p_key: key }),
    serverNow: () => rpc<string>('server_now'),
    listCandidates: (inductionId) =>
      send<CandidateSummary[]>((signal) =>
        client
          .from('candidates')
          .select('id, number, full_name, reg_number, status')
          .eq('induction_id', inductionId)
          .order('number')
          .abortSignal(signal),
      ),
    getDisplayKey: () => rpc<string>('get_display_key'),
    checkIn: (candidateId) => rpc<void>('check_in', { p_candidate_id: candidateId }),
    undoCheckIn: (candidateId) => rpc<void>('undo_check_in', { p_candidate_id: candidateId }),
    moveCandidate: (candidateId, panelId, position) =>
      rpc<void>('move_candidate', { p_candidate_id: candidateId, p_panel_id: panelId, p_position: position }),
    skipCandidate: (candidateId) => rpc<void>('skip_candidate', { p_candidate_id: candidateId }),
    sendIn: (candidateId, panelId) => rpc<string>('send_in', { p_candidate_id: candidateId, p_panel_id: panelId }),
    undoSendIn: (interviewId) => rpc<void>('undo_send_in', { p_interview_id: interviewId }),
    endInterview: (interviewId) => rpc<void>('end_interview', { p_interview_id: interviewId }),
    reopenInterview: (interviewId) => rpc<void>('reopen_interview', { p_interview_id: interviewId }),
    addPanel: () => rpc<string>('add_panel'),
    deletePanel: (panelId) => rpc<void>('delete_panel', { p_panel_id: panelId }),
    importCandidates: (rows) => rpc<ImportResult>('import_candidates', { p_rows: rows }, importTimeoutMs),
    subscribeBoard: () => broadcastSubscriber(client, 'board', true),
    subscribeDisplay: (key) => broadcastSubscriber(client, `display:${key}`, false),

    setMyPanel: (panelId) => rpc<void>('set_my_panel', { p_panel_id: panelId }),
    async candidate(candidateId) {
      const row = await send<Candidate | null>((signal) =>
        client.from('candidates').select(CANDIDATE_COLUMNS).eq('id', candidateId).abortSignal(signal).maybeSingle(),
      );
      if (!row) throw new ApiError('Candidate not found');
      return row;
    },
    panelInterviews: (panelId) =>
      send<PanelInterview[]>((signal) =>
        client
          .from('interviews')
          .select('id, status, started_at, ended_at, candidate:candidates(id, number, full_name)')
          .eq('panel_id', panelId)
          .neq('status', 'cancelled')
          .order('started_at', { ascending: false })
          .limit(30)
          .abortSignal(signal),
      ),
    criteria: (inductionId) =>
      send<Criterion[]>((signal) =>
        client
          .from('evaluation_criteria')
          .select('key, label, category, sort_order')
          .eq('induction_id', inductionId)
          .order('sort_order')
          .abortSignal(signal),
      ),
    interviewMessages: (interviewId) => rpc<ChatMessage[]>('interview_messages', { p_interview_id: interviewId }),
    postMessage: (interviewId, body, id) =>
      rpc<ChatMessage>('post_message', { p_interview_id: interviewId, p_body: body, p_id: id }),
    evaluationCount: (interviewId) => rpc<number>('evaluation_count', { p_interview_id: interviewId }),
    myEvaluations: (userId, inductionId) =>
      send<MyEvaluationWithInterview[]>((signal) =>
        client
          .from('evaluations')
          .select(
            'interview_id, scores, recommendation, comments, updated_at, ' +
              'interview:interviews!inner(id, status, started_at, ended_at, panel:panels(name), candidate:candidates(id, number, full_name))',
          )
          .eq('panelist_id', userId)
          .eq('interview.induction_id', inductionId)
          .neq('interview.status', 'cancelled')
          .abortSignal(signal),
      ),
    submitEvaluation: (interviewId, scores, recommendation, comments) =>
      rpc<void>('submit_evaluation', {
        p_interview_id: interviewId,
        p_scores: scores,
        p_recommendation: recommendation,
        p_comments: comments,
      }),
    subscribeInterview: (interviewId) => broadcastSubscriber(client, `interview:${interviewId}`, true),

    listAccounts: () =>
      send<Account[]>((signal) =>
        client
          .from('profiles')
          .select('id, username, display_name, role, is_active, current_panel_id')
          .order('username')
          .abortSignal(signal),
      ),
    async manageAccount(command) {
      let result;
      try {
        result = await client.functions.invoke('admin-users', { body: command, timeout: timeoutMs });
      } catch {
        throw new ApiError(NETWORK_ERROR);
      }
      const { error } = result;
      if (!error) return;
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response;
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        const message = response.status === 401 || response.status === 403 ? NOT_ALLOWED : body?.error?.trim() || 'Something went wrong';
        if (message === NOT_ALLOWED) notAllowed.emit();
        throw new ApiError(message);
      }
      const cause = (error as { context?: { name?: string } }).context;
      throw new ApiError(cause?.name === 'AbortError' || cause?.name === 'TimeoutError' ? TIMEOUT_ERROR : NETWORK_ERROR);
    },
    async induction() {
      const row = await send<InductionSettings | null>((signal) =>
        client
          .from('inductions')
          .select('id, name, target_interview_minutes, results_published')
          .eq('is_active', true)
          .abortSignal(signal)
          .maybeSingle(),
      );
      if (!row) throw new ApiError('No active induction');
      return row;
    },
    updateSettings: (name, targetMinutes) =>
      rpc<void>('update_settings', { p_name: name, p_target_minutes: targetMinutes }),
    regenerateDisplayKey: () => rpc<string>('regenerate_display_key'),
    resultsTable: () => rpc<ResultRow[]>('results_table'),
    candidateRecord: (candidateId) => rpc<CandidateRecord>('candidate_record', { p_candidate_id: candidateId }),
    evaluationsExport: () => rpc<EvaluationExportRow[]>('evaluations_export'),
    setDecision: (candidateId, decision) => rpc<void>('set_decision', { p_candidate_id: candidateId, p_decision: decision }),
    setResultsPublished: (published) => rpc<void>('set_results_published', { p_published: published }),

    publishedResults: () => rpc<PublishedResult[]>('published_results'),
  };
}
