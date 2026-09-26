import { parseServerTime } from '../lib/clock.ts';
import type { MyEvaluationWithInterview } from '../lib/types.ts';
import { RECOMMENDATIONS } from './evaluation.ts';

const recommendationLabel = (value: string) => RECOMMENDATIONS.find((r) => r.value === value)?.label ?? value;
const clock = (iso: string) => new Date(parseServerTime(iso)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface EvaluatedCandidatesProps {
  items: MyEvaluationWithInterview[];
  onOpen: (interviewId: string) => void;
}

/** Everyone this panelist has evaluated, from any panel, so they can look back and update it. */
export function EvaluatedCandidates({ items, onOpen }: EvaluatedCandidatesProps) {
  return (
    <section aria-label="Candidates you evaluated" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">
        Candidates you evaluated <span className="font-normal text-slate-500">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">You haven't evaluated anyone yet.</p>
      ) : (
        // A long day's list scrolls inside its box rather than stretching the page.
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {items.map(({ interview, recommendation }) => (
            <li key={interview.id} className="flex flex-wrap items-center gap-x-2 px-4 py-2">
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onOpen(interview.id)}>
                <span className="tabular-nums">#{interview.candidate.number}</span> <bdi>{interview.candidate.full_name}</bdi>
              </button>
              <span className="text-sm text-slate-600">
                <bdi>{interview.panel.name}</bdi> · {recommendationLabel(recommendation)} ·{' '}
                <time dateTime={interview.started_at}>{clock(interview.started_at)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
