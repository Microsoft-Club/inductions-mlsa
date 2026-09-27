// Pure decisions behind the panelist screen.
import { parseServerTime } from '../lib/clock.ts';
import type { BoardPanel, BoardSnapshot, InterviewStatus, MyEvaluationWithInterview, PanelInterview } from '../lib/types.ts';

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
}

const fromPanelInterview = (i: PanelInterview): ShownInterview => ({
  id: i.id,
  candidateId: i.candidate.id,
  status: i.status,
  startedAt: i.started_at,
  endedAt: i.ended_at,
});

/**
 * What the panelist sees: an interview they opened from Recent or from their evaluations; otherwise
 * the one in progress; otherwise the panel's latest one, which stays open after it ends (spec §9).
 */
export function shownInterview(
  panel: BoardPanel,
  recent: PanelInterview[],
  pinnedId: string | null,
  evaluated: MyEvaluationWithInterview[] = [],
): ShownInterview | null {
  // Recent reloads with every board change, so it wins over the evaluations' copy of the same interview.
  const pinned = pinnedId ? (recent.find((i) => i.id === pinnedId) ?? evaluated.find((e) => e.interview_id === pinnedId)?.interview) : undefined;
  if (pinned) return fromPanelInterview(pinned);
  if (panel.current) {
    return {
      id: panel.current.interview_id,
      candidateId: panel.current.candidate_id,
      status: 'in_progress',
      startedAt: panel.current.started_at,
      endedAt: null,
    };
  }
  return recent[0] ? fromPanelInterview(recent[0]) : null;
}

/**
 * The panel's other interviews, newest first, marking those this panelist hasn't evaluated.
 * `evaluated` is null while their evaluations are unknown; nothing is marked pending then.
 */
export function recentList(recent: PanelInterview[], shownId: string | null, evaluated: Set<string> | null) {
  return recent.filter((i) => i.id !== shownId).map((i) => ({ ...i, pending: evaluated !== null && !evaluated.has(i.id) }));
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
 * panel that ended without their evaluation. Nothing records who sat in each interview, so
 * "interviewed" is those two added up; an interview in progress counts once it's evaluated or ends.
 * null while their evaluations are unknown.
 */
export function panelistStats(recent: PanelInterview[], evaluations: MyEvaluationWithInterview[] | undefined): PanelistStats | null {
  if (!evaluations) return null;
  const evaluated = new Set(evaluations.map((e) => e.interview_id));
  const pending = recent.filter((i) => i.status === 'ended' && !evaluated.has(i.id)).length;
  return { interviewed: evaluations.length + pending, evaluated: evaluations.length, pending };
}
