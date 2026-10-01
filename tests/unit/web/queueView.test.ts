import { describe, expect, it } from 'vitest';
import type { CandidateSummary } from '../../../src/lib/types.ts';
import { canDeletePanel, describeLocation, filterCandidates, freePanels, notReadyConfirm, panelState, parseListFilter, poolHint, searchCandidates } from '../../../src/queue/queueView.ts';
import { board, boardPanel, ended, interview, lane } from './fixtures.ts';

const candidate = (number: number, full_name: string, status: CandidateSummary['status'], reg_number = `2025${number}`): CandidateSummary => ({
  id: `c${number}`,
  number,
  full_name,
  reg_number,
  status,
});

describe('poolHint', () => {
  it('pairs the first person in the pool with the first free panel that has nobody lined up', () => {
    const b = board({
      panels: [
        boardPanel('p1', 'Panel 1', { current: interview(7, 'Sara') }),
        boardPanel('p2', 'Panel 2', { lane: lane([12, 'Ali']) }),
        boardPanel('p3', 'Panel 3'),
      ],
    });
    expect(poolHint(b)).toEqual({ candidateId: 'c20', panelId: 'p3', panelName: 'Panel 3' });
  });

  it('skips a panel that is still wrapping up its last interview', () => {
    const b = board({
      panels: [boardPanel('p2', 'Panel 2', { last_ended: ended(6, 'Omar', null) }), boardPanel('p3', 'Panel 3', { last_ended: ended(5, 'Hina') })],
    });
    expect(poolHint(b)).toEqual({ candidateId: 'c20', panelId: 'p3', panelName: 'Panel 3' });
  });

  it('has no hint when every free panel has someone lined up, or the pool is empty', () => {
    expect(poolHint(board())).toBeNull();
    expect(poolHint(board({ panels: [boardPanel('p3', 'Panel 3')], pool: [] }))).toBeNull();
  });
});

describe('panelState and notReadyConfirm', () => {
  it('is busy during an interview, wrapping up after End until a panelist says ready, then ready', () => {
    expect(panelState(boardPanel('p1', 'Panel 1', { current: interview(7, 'Sara') }))).toBe('busy');
    expect(panelState(boardPanel('p1', 'Panel 1', { last_ended: ended(6, 'Omar', null) }))).toBe('wrapping_up');
    expect(panelState(boardPanel('p1', 'Panel 1', { last_ended: ended(6, 'Omar') }))).toBe('ready');
    expect(panelState(boardPanel('p1', 'Panel 1'))).toBe('ready'); // nobody interviewed yet
  });

  it('asks before sending someone in to a panel that has not said it is ready', () => {
    expect(notReadyConfirm(boardPanel('p2', 'Panel 2', { last_ended: ended(6, 'Omar', null) }), 12)).toBe(
      "Panel 2 hasn't said they're ready yet. Send #12 in anyway?",
    );
    expect(notReadyConfirm(boardPanel('p2', 'Panel 2', { last_ended: ended(6, 'Omar') }), 12)).toBeUndefined();
  });
});

describe('freePanels and canDeletePanel', () => {
  it('lists panels without an interview in progress', () => {
    expect(freePanels(board()).map((p) => p.id)).toEqual(['p2']);
  });

  it('lets admins remove any panel and the queue manager only extra ones', () => {
    const defaultPanel = boardPanel('p1', 'Panel 1', { is_default: true });
    const extraPanel = boardPanel('p3', 'Panel 3');
    expect(canDeletePanel(defaultPanel, 'admin')).toBe(true);
    expect(canDeletePanel(defaultPanel, 'queue_manager')).toBe(false);
    expect(canDeletePanel(extraPanel, 'queue_manager')).toBe(true);
    expect(canDeletePanel(extraPanel, 'panelist')).toBe(false);
  });
});

describe('describeLocation', () => {
  it('says where each candidate is on the board', () => {
    const b = board();
    expect(describeLocation(b, candidate(5, 'Not Here', 'registered'))).toBe('Not checked in');
    expect(describeLocation(b, candidate(21, 'عائشہ خان', 'waiting'))).toBe('Waiting · pool #2');
    expect(describeLocation(b, candidate(12, 'Ali Raza', 'waiting'))).toBe('Waiting · lined up for Panel 2 (#1)');
    expect(describeLocation(b, candidate(7, 'Sara Ahmed', 'interviewing'))).toBe('Interviewing in Panel 1');
    expect(describeLocation(b, candidate(3, 'Done', 'interviewed'))).toBe('Interviewed');
  });
});

describe('searchCandidates', () => {
  const list = [
    candidate(1, 'Ali Raza', 'registered', '2025112'),
    candidate(12, 'Bilal Khan', 'waiting', '2025200'),
    candidate(40, 'عائشہ خان', 'registered', '2025102'),
    candidate(41, "Zara O'Brien-Khan", 'interviewed', 'U2025041'),
  ];

  it('matches an exact number first, then reg numbers containing it', () => {
    expect(searchCandidates(list, '12').map((c) => c.number)).toEqual([12, 1]);
    expect(searchCandidates(list, '#40').map((c) => c.number)).toEqual([40]);
  });

  it('matches names in any case and script, and reg numbers typed with spaces or lowercase', () => {
    expect(searchCandidates(list, 'KHAN').map((c) => c.number)).toEqual([12, 41]);
    expect(searchCandidates(list, 'عائشہ').map((c) => c.number)).toEqual([40]);
    expect(searchCandidates(list, "o'brien").map((c) => c.number)).toEqual([41]);
    expect(searchCandidates(list, ' 2025 102 ').map((c) => c.number)).toEqual([40]);
    expect(searchCandidates(list, 'u2025041').map((c) => c.number)).toEqual([41]);
  });

  it('returns nothing for a blank query and caps the list', () => {
    expect(searchCandidates(list, '   ')).toEqual([]);
    expect(searchCandidates(list, 'a', 2)).toHaveLength(2);
  });
});

describe('filterCandidates', () => {
  const list = [
    candidate(20, 'Bilal Khan', 'waiting', '2025020'),
    candidate(5, 'Hina Tariq', 'registered', '2025005'),
    candidate(3, 'عائشہ خان', 'registered', '2025003'),
    candidate(1, 'Omar Farooq', 'interviewed', '2025001'),
  ];

  it('lists everyone with a status, in number order, with no cap', () => {
    expect(filterCandidates(list, 'registered', '').map((c) => c.number)).toEqual([3, 5]);
    expect(filterCandidates(list, 'all', '  ').map((c) => c.number)).toEqual([1, 3, 5, 20]);
    const many = Array.from({ length: 300 }, (_, i) => candidate(i + 1, `Person ${i + 1}`, 'registered'));
    expect(filterCandidates(many, 'registered', '')).toHaveLength(300);
  });

  it('narrows the list by number, name or reg number', () => {
    expect(filterCandidates(list, 'all', 'khan').map((c) => c.number)).toEqual([20]);
    expect(filterCandidates(list, 'registered', ' 2025 003 ').map((c) => c.number)).toEqual([3]);
    expect(filterCandidates(list, 'all', '#5').map((c) => c.number)).toEqual([5]);
    expect(filterCandidates(list, 'waiting', 'hina')).toEqual([]);
  });
});

describe('parseListFilter', () => {
  it('accepts the four statuses and "all", and nothing else', () => {
    expect(['registered', 'waiting', 'interviewing', 'interviewed', 'all'].map(parseListFilter)).toEqual([
      'registered', 'waiting', 'interviewing', 'interviewed', 'all',
    ]);
    expect(parseListFilter(null)).toBeNull();
    expect(parseListFilter('everyone')).toBeNull();
  });
});
