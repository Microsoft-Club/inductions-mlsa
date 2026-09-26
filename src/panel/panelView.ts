// Pure decisions behind the panelist screen.
import type { BoardPanel, BoardSnapshot, InterviewStatus, PanelInterview } from '../lib/types.ts';

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
 * What the panelist sees: an interview they opened from Recent; otherwise the one in progress;
 * otherwise the panel's latest one, which stays open after it ends (spec §9).
 */
export function shownInterview(panel: BoardPanel, recent: PanelInterview[], pinnedId: string | null): ShownInterview | null {
  const pinned = pinnedId ? recent.find((i) => i.id === pinnedId) : undefined;
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
