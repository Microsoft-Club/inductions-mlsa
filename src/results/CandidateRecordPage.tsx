import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider } from '../components/ActionProvider.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import { formatElapsed, parseServerTime } from '../lib/clock.ts';
import type { CandidateRecord, Criterion, RecordInterview } from '../lib/types.ts';
import { ApplicationTabs } from '../panel/ApplicationTabs.tsx';
import { CandidateCard } from '../panel/CandidateCard.tsx';
import { RECOMMENDATIONS } from '../panel/evaluation.ts';
import { DecisionSelect } from './DecisionSelect.tsx';

const clock = (iso: string) => new Date(parseServerTime(iso)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const recommendationLabel = (value: string) => RECOMMENDATIONS.find((r) => r.value === value)?.label ?? value;

/** /results/:candidateId: answers, every interview (panel, times, duration), chats and evaluations. */
export function CandidateRecordPage() {
  const api = useApi();
  const { candidateId = '' } = useParams();
  const [record, setRecord] = useState<CandidateRecord | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRecord(await api.candidateRecord(candidateId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, candidateId]);

  useEffect(() => {
    void load();
    api.induction().then((i) => api.criteria(i.id)).then(setCriteria, () => {});
  }, [api, load]);

  useEffect(() => {
    if (record) document.title = `#${record.candidate.number} ${record.candidate.full_name} · Results`;
  }, [record]);

  if (!record) {
    return (
      <FullPageMessage title={error ? "Couldn't load this candidate" : 'Loading…'}>
        {error && <p>{error}</p>}
        <Link className={`${buttonClasses('secondary', 'md')} mt-3`} to="/results">
          ← All results
        </Link>
      </FullPageMessage>
    );
  }

  const { candidate, interviews } = record;
  return (
    <ActionProvider onSettled={() => void load()}>
      <main className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className="text-sm font-medium text-brand-700 hover:underline" to="/results">
            ← All results
          </Link>
          <label className="flex items-center gap-2 text-sm font-medium">
            Decision
            <DecisionSelect candidateId={candidate.id} number={candidate.number} name={candidate.full_name} decision={candidate.decision} />
          </label>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-4">
            <CandidateCard candidate={candidate} targetMinutes={0} />
            <ApplicationTabs candidate={candidate} />
          </div>
          <div className="space-y-4">
            {interviews.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">No interviews yet.</p>
            ) : (
              interviews.map((interview) => <InterviewRecord key={interview.id} interview={interview} criteria={criteria} />)
            )}
          </div>
        </div>
      </main>
    </ActionProvider>
  );
}

function InterviewRecord({ interview, criteria }: { interview: RecordInterview; criteria: Criterion[] }) {
  const timing =
    interview.status === 'cancelled'
      ? 'Cancelled (sent back to the queue)'
      : interview.ended_at
        ? `${clock(interview.started_at)}–${clock(interview.ended_at)} · ${formatElapsed(parseServerTime(interview.ended_at) - parseServerTime(interview.started_at))}`
        : `${clock(interview.started_at)} · in progress`;

  return (
    <section aria-label={`${interview.panel_name} interview`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">
        {interview.panel_name} <span className="font-normal text-slate-600">· {timing}</span>
      </h2>
      {interview.evaluations.length === 0 ? (
        <p className="text-sm text-slate-500">No evaluations.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Evaluations" className="w-full text-left text-xs">
            <thead className="text-slate-600">
              <tr>
                <th className="py-1 pr-2">Panelist</th>
                {criteria.map((c) => (
                  <th key={c.key} className="py-1 pr-2" title={c.label}>
                    {c.label}
                  </th>
                ))}
                <th className="py-1 pr-2">Recommendation</th>
                <th className="py-1">Comments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {interview.evaluations.map((e, i) => (
                // Display names needn't be unique and evaluations carry no id; the server's order is stable.
                <tr key={i}>
                  <td className="py-1 pr-2 font-medium">{e.panelist_name}</td>
                  {criteria.map((c) => (
                    <td key={c.key} className="py-1 pr-2 tabular-nums">
                      {e.scores[c.key] ?? '—'}
                    </td>
                  ))}
                  <td className="py-1 pr-2">{recommendationLabel(e.recommendation)}</td>
                  <td dir="auto" className="py-1 whitespace-pre-wrap">
                    {e.comments}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold">Discussion</h3>
        {interview.messages.length === 0 ? (
          <p className="text-sm text-slate-500">No messages.</p>
        ) : (
          <ol className="mt-1 space-y-1 text-sm">
            {interview.messages.map((m) => (
              <li key={m.id}>
                <span className="font-medium">{m.author_name}</span> <span className="text-xs text-slate-500">{clock(m.created_at)}</span>
                <p dir="auto" className="whitespace-pre-wrap">
                  {m.body}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
