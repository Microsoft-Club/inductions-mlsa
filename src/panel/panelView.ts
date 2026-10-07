// Pure decisions behind the panelist screen.
import { parseServerTime } from '../lib/clock.ts';
import type { BoardPanel, BoardSnapshot, InterviewStatus, InterviewWithPanel, MyEvaluationWithInterview, PanelInterview } from '../lib/types.ts';

/** The panel this person is sitting in, from the board's "panelists present" lists. */
export function myPanel(board: BoardSnapshot, userId: string): BoardPanel | null {
  return board.panels.find((panel) => panel.panelists.some((p) => p.id === userId)) ?? null;
}

export interface ShownInterview {
  id: string;
  candidateId: string;
  status: InterviewStatus;
  startedAt: string;
  endedAt: string | null;
  /** It belongs to the panel you're sitting in (only its panelists may end it). */
  inThisPanel: boolean;
}

const fromPanelInterview = (i: PanelInterview, inThisPanel: boolean): ShownInterview => ({
  id: i.id,
  candidateId: i.candidate.id,
  status: i.status,
  startedAt: i.started_at,
  endedAt: i.ended_at,
  inThisPanel,
});

/**
 * The panel's latest interviews plus every older one still waiting for this panelist's evaluation
 * (the latest list stops at 30, so a busy panel would otherwise lose them), newest first.
 */
export function withPending(recent: PanelInterview[], pending: PanelInterview[]): PanelInterview[] {
  const loaded = new Set(recent.map((i) => i.id));
  const older = pending.filter((i) => !loaded.has(i.id));
  if (older.length === 0) return recent;
  return [...recent, ...older].sort((a, b) => parseServerTime(b.started_at) - parseServerTime(a.started_at));
}

/** An interview you sat in on a panel you've since left, still waiting for your evaluation. */
export type LeftBehind = PanelInterview & { panelName: string };

/**
 * The interviews this panelist sat in on other panels (remembered on this device) that they haven't
 * evaluated yet, so a switch never hides one they still owe. Empty while their evaluations are unknown.
 */
export function leftBehind(satIn: InterviewWithPanel[], panelId: string, evaluated: Set<string> | null): LeftBehind[] {
  if (!evaluated) return [];
  return satIn
    .filter((i) => i.panel_id !== panelId && !evaluated.has(i.id))
    .map((i) => ({ id: i.id, status: i.status, started_at: i.started_at, ended_at: i.ended_at, candidate: i.candidate, panelName: i.panel.name }));
}

/**
 * What the panelist sees: an interview they opened from Recent or from their evaluations; otherwise
 * the one in progress; otherwise the panel's latest one, which stays open after it ends (spec §9).
 */
export function shownInterview(
  panel: BoardPanel,
  recent: PanelInterview[],
  pinnedId: string | null,
  evaluated: MyEvaluationWithInterview[] = [],
  elsewhere: LeftBehind[] = [],
): ShownInterview | null {
  // Recent reloads with every board change, so it wins over the evaluations' copy of the same interview.
  if (pinnedId) {
    const fromRecent = recent.find((i) => i.id === pinnedId);
    if (fromRecent) return fromPanelInterview(fromRecent, true);
    const fromElsewhere = elsewhere.find((i) => i.id === pinnedId);
    if (fromElsewhere) return fromPanelInterview(fromElsewhere, false);
    const fromEvaluated = evaluated.find((e) => e.interview_id === pinnedId)?.interview;
    if (fromEvaluated) return fromPanelInterview(fromEvaluated, fromEvaluated.panel?.name === panel.name);
  }
  if (panel.current) {
    return {
      id: panel.current.interview_id,
      candidateId: panel.current.candidate_id,
      status: 'in_progress',
      startedAt: panel.current.started_at,
      endedAt: null,
      inThisPanel: true,
    };
  }
  return recent[0] ? fromPanelInterview(recent[0], true) : null;
}

/**
 * The panel's other interviews and those left behind on other panels, newest first, marking those
 * this panelist hasn't evaluated. `evaluated` is null while their evaluations are unknown; nothing is
 * marked pending then.
 */
export function recentList(recent: PanelInterview[], shownId: string | null, evaluated: Set<string> | null, elsewhere: LeftBehind[] = []) {
  const all: Array<PanelInterview & { panelName?: string }> = [...recent, ...elsewhere];
  return all
    .sort((a, b) => parseServerTime(b.started_at) - parseServerTime(a.started_at))
    .filter((i) => i.id !== shownId)
    .map((i) => ({ ...i, pending: evaluated !== null && !evaluated.has(i.id) }));
}

/** The candidates this panelist has evaluated, newest interview first. */
export function evaluatedList(evaluations: MyEvaluationWithInterview[]): MyEvaluationWithInterview[] {
  return [...evaluations].sort((a, b) => parseServerTime(b.interview.started_at) - parseServerTime(a.interview.started_at));
}

export interface PanelistStats {
  interviewed: number;
  evaluated: number;
  pending: number;
}

/**
 * The panelist's own numbers: evaluations they submitted (from any panel), and interviews on this
 * panel, or left behind on another, that ended without their evaluation. The server doesn't record
 * who sat in each interview, so "interviewed" is those two added up; an interview in progress counts
 * once it's evaluated or ends. null while their evaluations are unknown.
 */
export function panelistStats(
  recent: PanelInterview[],
  evaluations: MyEvaluationWithInterview[] | undefined,
  elsewhere: LeftBehind[] = [],
): PanelistStats | null {
  if (!evaluations) return null;
  const evaluated = new Set(evaluations.map((e) => e.interview_id));
  const pending = [...recent, ...elsewhere].filter((i) => i.status === 'ended' && !evaluated.has(i.id)).length;
  return { interviewed: evaluations.length + pending, evaluated: evaluations.length, pending };
}
