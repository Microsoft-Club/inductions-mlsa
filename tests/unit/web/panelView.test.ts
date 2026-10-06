import { describe, expect, it } from 'vitest';
import type { InterviewWithPanel, MyEvaluationWithInterview, PanelInterview } from '../../../src/lib/types.ts';
import { leftBehind, panelistStats, recentList, shownInterview } from '../../../src/panel/panelView.ts';
import { boardPanel } from './fixtures.ts';

const interview = (n: number, status: PanelInterview['status'] = 'ended'): PanelInterview => ({
  id: `i${n}`,
  status,
  started_at: `2026-09-26T09:${String(n).padStart(2, '0')}:00Z`,
  ended_at: status === 'ended' ? '2026-09-26T09:15:00Z' : null,
  candidate: { id: `c${n}`, number: n, full_name: `Candidate ${n}` },
});
const evaluation = (i: PanelInterview, panel = 'Panel 1'): MyEvaluationWithInterview => ({
  interview_id: i.id,
  scores: {},
  recommendation: 'yes',
  comments: '',
  updated_at: '2026-09-26T09:20:00Z',
  interview: { ...i, panel: { name: panel } },
});

describe('panelistStats', () => {
  it('counts what you evaluated anywhere, and the ended interviews on your panel you have not', () => {
    const recent = [interview(7, 'in_progress'), interview(6), interview(5)];
    const mine = [evaluation(interview(6)), evaluation(interview(3), 'Panel 2')];
    expect(panelistStats(recent, mine)).toEqual({ interviewed: 3, evaluated: 2, pending: 1 });
  });

  it('counts the interview in progress only once you have evaluated it', () => {
    const recent = [interview(7, 'in_progress')];
    expect(panelistStats(recent, [])).toEqual({ interviewed: 0, evaluated: 0, pending: 0 });
    expect(panelistStats(recent, [evaluation(recent[0])])).toEqual({ interviewed: 1, evaluated: 1, pending: 0 });
  });

  it('says nothing while your evaluations are still loading', () => {
    expect(panelistStats([interview(5)], undefined)).toBeNull();
  });

  it('counts an ended interview you left on another panel without evaluating', () => {
    const elsewhere = leftBehind([onPanel(interview(3), 'p2', 'Panel 2')], 'p1', new Set());
    expect(panelistStats([interview(6)], [], elsewhere)).toEqual({ interviewed: 2, evaluated: 0, pending: 2 });
  });
});

const onPanel = (i: PanelInterview, panelId: string, name: string): InterviewWithPanel => ({ ...i, panel_id: panelId, panel: { name } });

describe('leftBehind', () => {
  const satIn = [onPanel(interview(3), 'p2', 'Panel 2'), onPanel(interview(4), 'p1', 'Panel 1'), onPanel(interview(5), 'p2', 'Panel 2')];

  it('lists what you sat in on other panels and have not evaluated, with the panel name', () => {
    expect(leftBehind(satIn, 'p1', new Set(['i5']))).toEqual([{ ...interview(3), panelName: 'Panel 2' }]);
  });

  it('lists nothing while your evaluations are unknown', () => {
    expect(leftBehind(satIn, 'p1', null)).toEqual([]);
  });
});

describe('recentList and shownInterview with interviews left behind', () => {
  const elsewhere = leftBehind([onPanel(interview(4, 'in_progress'), 'p2', 'Panel 2')], 'p1', new Set());

  it('puts them among the panel\'s own interviews, newest first', () => {
    const list = recentList([interview(5), interview(3)], null, new Set(), elsewhere);
    expect(list.map((i) => [i.id, i.panelName, i.pending])).toEqual([['i5', undefined, true], ['i4', 'Panel 2', true], ['i3', undefined, true]]);
  });

  it('opens one without End: it belongs to the other panel', () => {
    const panel = boardPanel('p1', 'Panel 1');
    expect(shownInterview(panel, [interview(5)], 'i4', [], elsewhere)).toMatchObject({ id: 'i4', status: 'in_progress', inThisPanel: false });
    // Not pinned: the panel's own latest interview, never the other panel's.
    expect(shownInterview(panel, [interview(5)], null, [], elsewhere)).toMatchObject({ id: 'i5', inThisPanel: true });
  });
});
