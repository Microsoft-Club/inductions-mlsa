import { describe, expect, it } from 'vitest';
import type { MyEvaluationWithInterview, PanelInterview } from '../../../src/lib/types.ts';
import { panelistStats } from '../../../src/panel/panelView.ts';

const interview = (n: number, status: PanelInterview['status'] = 'ended'): PanelInterview => ({
  id: `i${n}`,
  status,
  started_at: '2026-09-26T09:00:00Z',
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
});
