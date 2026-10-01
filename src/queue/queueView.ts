// Pure decisions behind the queue board, kept out of the components so they are easy to test.
import type { BoardPanel, BoardSnapshot, CandidateStatus, CandidateSummary, Role } from '../lib/types.ts';

export interface PoolHint {
  candidateId: string;
  panelId: string;
  panelName: string;
}

export type PanelState = 'busy' | 'wrapping_up' | 'ready';

/** Busy during an interview; after End it is wrapping up until one of its panelists says it is ready. */
export function panelState(panel: BoardPanel): PanelState {
  if (panel.current) return 'busy';
  return panel.last_ended && panel.last_ended.ready_at === null ? 'wrapping_up' : 'ready';
}

/** What Send in asks first when the panel hasn't said it is ready; nothing once it has. */
export function notReadyConfirm(panel: BoardPanel, number: number): string | undefined {
  return panelState(panel) === 'wrapping_up' ? `${panel.name} hasn't said they're ready yet. Send #${number} in anyway?` : undefined;
}

/** A ready panel with nobody lined up, paired with the first person in the pool (panels in board order). */
export function poolHint(board: BoardSnapshot): PoolHint | null {
  const first = board.pool[0];
  const panel = board.panels.find((p) => panelState(p) === 'ready' && p.lane.length === 0);
  return first && panel ? { candidateId: first.candidate_id, panelId: panel.id, panelName: panel.name } : null;
}

export function freePanels(board: BoardSnapshot): BoardPanel[] {
  return board.panels.filter((panel) => panel.current === null);
}

/** Admins may remove any panel; the queue manager only the extra (non-default) ones. */
export function canDeletePanel(panel: BoardPanel, role: Role): boolean {
  return role === 'admin' || (role === 'queue_manager' && !panel.is_default);
}

/** Where a candidate is right now, for search results. */
export function describeLocation(board: BoardSnapshot, candidate: CandidateSummary): string {
  switch (candidate.status) {
    case 'registered':
      return 'Not checked in';
    case 'waiting': {
      const inPool = board.pool.find((e) => e.candidate_id === candidate.id);
      if (inPool) return `Waiting · pool #${inPool.position}`;
      for (const panel of board.panels) {
        const inLane = panel.lane.find((e) => e.candidate_id === candidate.id);
        if (inLane) return `Waiting · lined up for ${panel.name} (#${inLane.position})`;
      }
      return 'Waiting';
    }
    case 'interviewing': {
      const panel = board.panels.find((p) => p.current?.candidate_id === candidate.id);
      return panel ? `Interviewing in ${panel.name}` : 'Interviewing';
    }
    case 'interviewed':
      return 'Interviewed';
  }
}

/** Does a candidate match what someone typed: a number ("12" or "#12"), part of a name, or part of a reg number? */
function matcher(query: string): ((c: CandidateSummary) => boolean) & { exactNumber: number | null } {
  const q = query.trim();
  const exactNumber = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
  const reg = q.replace(/\s+/g, '').toUpperCase();
  const name = q.toLocaleLowerCase();
  const matches = (c: CandidateSummary) =>
    c.number === exactNumber || c.reg_number.includes(reg) || c.full_name.toLocaleLowerCase().includes(name);
  return Object.assign(matches, { exactNumber });
}

/**
 * Finds candidates by number ("12" or "#12"), name (any case, any script) or reg number (spaces
 * and case ignored). An exact number match comes first, then everyone else by number.
 */
export function searchCandidates(list: CandidateSummary[], query: string, limit = 20): CandidateSummary[] {
  if (!query.trim()) return [];
  const matches = matcher(query);
  return list
    .filter(matches)
    .sort((a, b) => Number(b.number === matches.exactNumber) - Number(a.number === matches.exactNumber) || a.number - b.number)
    .slice(0, limit);
}

export type ListFilter = CandidateStatus | 'all';

export const LIST_FILTERS: ListFilter[] = ['registered', 'waiting', 'interviewing', 'interviewed', 'all'];

/** The ?list= value of /queue, if it names a list. */
export function parseListFilter(value: string | null): ListFilter | null {
  return LIST_FILTERS.find((filter) => filter === value) ?? null;
}

/** Everyone with a status (or everyone), in number order, narrowed by an optional query. */
export function filterCandidates(list: CandidateSummary[], filter: ListFilter, query: string): CandidateSummary[] {
  const matches = query.trim() ? matcher(query) : () => true;
  return list
    .filter((c) => (filter === 'all' || c.status === filter) && matches(c))
    .sort((a, b) => a.number - b.number);
}
