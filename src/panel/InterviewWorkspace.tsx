import { useEffect, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import type { Candidate, Criterion, MyEvaluation } from '../lib/types.ts';
import { ApplicationTabs } from './ApplicationTabs.tsx';
import { CandidateCard } from './CandidateCard.tsx';
import { ChatPanel } from './ChatPanel.tsx';
import { EvaluationForm } from './EvaluationForm.tsx';
import type { ShownInterview } from './panelView.ts';
import { useInterviewLive } from './useInterviewLive.ts';

type PhoneTab = 'application' | 'chat' | 'evaluate';

interface InterviewWorkspaceProps {
  interview: ShownInterview;
  userId: string;
  /** null until the criteria have loaded. */
  criteria: Criterion[] | null;
  /** undefined until this person's evaluations have loaded. */
  evaluations: MyEvaluation[] | undefined;
  /** Loading the criteria or the evaluations failed; the form waits for both. */
  formFailed: boolean;
  onRetryForm: () => void;
  locked: boolean;
  targetMinutes: number;
  onEvaluationSubmitted: () => void;
}

/** Application · Discussion · My evaluation for one interview. Keyed by interview id by its parent. */
export function InterviewWorkspace({ interview, userId, criteria, evaluations, formFailed, onRetryForm, locked, targetMinutes, onEvaluationSubmitted }: InterviewWorkspaceProps) {
  const api = useApi();
  const live = useInterviewLive(interview.id);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<PhoneTab>('application');

  useEffect(() => {
    let current = true;
    api.candidate(interview.candidateId).then(
      (row) => current && setCandidate(row),
      (e) => current && setLoadError(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [api, interview.candidateId, attempt]);

  const saved = evaluations?.find((e) => e.interview_id === interview.id);
  const show = (which: PhoneTab) => (tab === which ? '' : 'hidden lg:block');

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Show" className="flex gap-1 rounded-lg bg-slate-100 p-1 lg:hidden">
        {(['application', 'chat', 'evaluate'] as const).map((which) => (
          <button
            key={which}
            type="button"
            role="tab"
            aria-selected={tab === which}
            onClick={() => setTab(which)}
            className={`flex-1 rounded-md py-2 text-sm font-medium ${tab === which ? 'bg-white shadow-sm' : 'text-slate-600'}`}
          >
            {which === 'application' ? 'Application' : which === 'chat' ? 'Chat' : 'Evaluate'}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className={`space-y-4 ${show('application')}`}>
          {candidate ? (
            <>
              <CandidateCard
                candidate={candidate}
                interview={{ id: interview.id, status: interview.status, started_at: interview.startedAt, ended_at: interview.endedAt }}
                targetMinutes={targetMinutes}
              />
              <ApplicationTabs candidate={candidate} />
            </>
          ) : loadError ? (
            <div role="alert" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <p>{loadError}</p>
              <button
                type="button"
                className={`${buttonClasses('secondary')} mt-2`}
                onClick={() => {
                  setLoadError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </button>
            </div>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading the application…</p>
          )}
        </div>
        <div className={show('chat')}>
          <ChatPanel interviewId={interview.id} live={live} meId={userId} />
        </div>
        <div className={show('evaluate')}>
          {evaluations && criteria ? (
            <EvaluationForm
              key={saved?.updated_at ?? 'new'}
              interviewId={interview.id}
              userId={userId}
              criteria={criteria}
              saved={saved}
              evaluationCount={live.data?.evaluationCount ?? 0}
              locked={locked}
              onSubmitted={() => {
                live.reload();
                onEvaluationSubmitted();
              }}
            />
          ) : formFailed ? (
            <div role="alert" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <p>Couldn't load your evaluation form. Check the connection.</p>
              <button type="button" className={`${buttonClasses('secondary')} mt-2`} onClick={onRetryForm}>
                Try again
              </button>
            </div>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading your evaluation…</p>
          )}
        </div>
      </div>
    </div>
  );
}
