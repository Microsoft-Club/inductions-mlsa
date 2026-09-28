import { ActionButton } from '../components/ActionButton.tsx';
import { Timer } from '../components/Timer.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { formatElapsed, parseServerTime } from '../lib/clock.ts';
import type { Candidate, InterviewStatus } from '../lib/types.ts';
import { CandidatePhoto } from '../photos/CandidatePhoto.tsx';
import { rankedPreferences } from './applicationView.ts';

export interface CardInterview {
  id: string;
  status: InterviewStatus;
  started_at: string;
  ended_at: string | null;
}

interface CandidateCardProps {
  candidate: Candidate;
  /** The interview on show, if any: adds the timer and End interview. */
  interview?: CardInterview;
  targetMinutes: number;
  /** Offer End interview (only the panelists in the interview's own panel may end it). */
  canEnd?: boolean;
}

export function CandidateCard({ candidate, interview, targetMinutes, canEnd = true }: CandidateCardProps) {
  const api = useApi();
  const preferences = rankedPreferences(candidate.preferences);
  const details = [candidate.reg_number, candidate.department, candidate.batch].filter((d) => d.trim() !== '').join(' · ');

  return (
    <section aria-label={`Candidate #${candidate.number}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <CandidatePhoto candidateId={candidate.id} version={candidate.photo_taken_at} name={candidate.full_name} />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">
              <span className="tabular-nums">#{candidate.number}</span> <bdi>{candidate.full_name}</bdi>
            </h2>
            <p className="text-sm text-slate-600">{details}</p>
          </div>
        </div>
        {interview?.status === 'in_progress' && (
          <div className="flex items-center gap-3">
            <Timer startedAt={interview.started_at} targetMinutes={targetMinutes} className="text-2xl font-semibold" />
            {canEnd && (
              <ActionButton
                variant="primary"
                size="md"
                confirm={`End the interview with #${candidate.number} ${candidate.full_name}?`}
                action={() => api.endInterview(interview.id)}
              >
                End interview
              </ActionButton>
            )}
          </div>
        )}
        {interview?.status === 'ended' && interview.ended_at && (
          <p className="text-sm font-medium text-slate-600">
            Interview ended · {formatElapsed(parseServerTime(interview.ended_at) - parseServerTime(interview.started_at))}
          </p>
        )}
      </div>
      {preferences.length > 0 && (
        <ol aria-label="Team preferences" className="mt-3 flex flex-wrap gap-2 text-sm">
          {preferences.map((p) => (
            <li key={p.rank} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-brand-700">
              <span className="mr-1 font-semibold tabular-nums">{p.rank}</span>
              {p.team}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
