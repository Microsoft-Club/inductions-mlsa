import { useEffect, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { useToast } from '../components/Toasts.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import { parseServerTime } from '../lib/clock.ts';
import type { Criterion, MyEvaluation, Recommendation } from '../lib/types.ts';
import {
  clearDraft,
  draftFromEvaluation,
  draftKey,
  loadDraft,
  MAX_COMMENTS,
  RECOMMENDATIONS,
  saveDraft,
  sameAsSaved,
  validateDraft,
  type EvaluationDraft,
} from './evaluation.ts';

interface EvaluationFormProps {
  interviewId: string;
  userId: string;
  criteria: Criterion[];
  /** This person's submitted evaluation for the interview, if any. */
  saved?: MyEvaluation;
  evaluationCount: number;
  /** Results are published: the server refuses changes, so the form is read-only. */
  locked: boolean;
  /** After every submit, even a failed one (the server may have saved it and only the reply was lost): reload what it has. */
  afterSubmit: () => void;
}

/** "My evaluation". Keyed by interview id by its parent, so each interview starts from its own draft. */
export function EvaluationForm({ interviewId, userId, criteria, saved, evaluationCount, locked, afterSubmit }: EvaluationFormProps) {
  const api = useApi();
  const toast = useToast();
  const key = draftKey(userId, interviewId);
  const [draft, setDraft] = useState<EvaluationDraft>(() => loadDraft(key) ?? draftFromEvaluation(saved));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dirty = !sameAsSaved(draft, saved);

  useEffect(() => {
    if (dirty) saveDraft(key, draft);
    else clearDraft(key);
  }, [key, draft, dirty]);

  const setScore = (criterion: string, value: number | null) =>
    setDraft((d) => {
      const scores = { ...d.scores };
      if (value === null) delete scores[criterion];
      else scores[criterion] = value;
      return { ...d, scores };
    });

  async function submit() {
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.submitEvaluation(interviewId, draft.scores, draft.recommendation as Recommendation, draft.comments.trim());
      clearDraft(key);
      toast.show('Evaluation submitted', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSubmitting(false);
      afterSubmit();
    }
  }

  const general = criteria.filter((c) => c.category === 'general');
  const teamFit = criteria.filter((c) => c.category === 'team_fit');
  const submittedAt = saved ? new Date(parseServerTime(saved.updated_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <section aria-label="My evaluation" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold">My evaluation</h2>
        <span className="text-sm text-slate-600">
          {evaluationCount === 0
            ? 'No one has submitted yet'
            : `${evaluationCount} panelist${evaluationCount === 1 ? ' has' : 's have'} submitted`}
        </span>
      </header>
      <form
        className="space-y-5 px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {locked && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">Results are published; evaluations are locked.</p>
        )}
        <fieldset disabled={locked || submitting} className="space-y-5">
          <ScoreGroup title="General (1–5)" criteria={general} clearLabel="–" clearName="No score" draft={draft} interviewId={interviewId} onChange={setScore} />
          <ScoreGroup title="Team fit (1–5 or N/A)" criteria={teamFit} clearLabel="N/A" clearName="N/A" draft={draft} interviewId={interviewId} onChange={setScore} />

          <fieldset>
            <legend className="text-sm font-semibold">Overall recommendation</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RECOMMENDATIONS.map((r) => (
                <label
                  key={r.value}
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border px-2 py-2 text-sm font-medium has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 ${
                    locked ? 'cursor-not-allowed opacity-60' : 'border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${interviewId}-recommendation`}
                    checked={draft.recommendation === r.value}
                    onChange={() => setDraft((d) => ({ ...d, recommendation: r.value }))}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm font-semibold">
            Comments (optional)
            <textarea
              value={draft.comments}
              onChange={(e) => setDraft((d) => ({ ...d, comments: e.target.value }))}
              rows={4}
              maxLength={MAX_COMMENTS}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            />
          </label>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {submittedAt ? `You submitted at ${submittedAt}${dirty ? ' · unsaved changes' : ''}` : dirty ? 'Draft saved on this device' : ''}
          </span>
          <button type="submit" className={buttonClasses('primary', 'md')} disabled={locked || submitting}>
            {saved ? 'Update evaluation' : 'Submit evaluation'}
          </button>
        </div>
      </form>
    </section>
  );
}

interface ScoreGroupProps {
  title: string;
  criteria: Criterion[];
  clearLabel: string;
  clearName: string;
  draft: EvaluationDraft;
  interviewId: string;
  onChange: (criterion: string, value: number | null) => void;
}

function ScoreGroup({ title, criteria, clearLabel, clearName, draft, interviewId, onChange }: ScoreGroupProps) {
  if (criteria.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {criteria.map((c) => (
        // Label above the buttons on a phone, beside them on wider screens. The legend names the group.
        <fieldset key={c.key} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
          <legend className="sr-only">{c.label}</legend>
          <span aria-hidden="true" className="text-sm text-slate-700">
            {c.label}
          </span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, null].map((value) => (
              <label
                key={value ?? 'clear'}
                className={`flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-md border px-2 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${
                  value === null
                    ? 'border-slate-200 text-slate-500 has-[:checked]:bg-slate-100 has-[:checked]:text-slate-700'
                    : 'border-slate-300 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-600 has-[:checked]:text-white'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`${interviewId}-${c.key}`}
                  aria-label={value === null ? clearName : String(value)}
                  checked={value === null ? draft.scores[c.key] === undefined : draft.scores[c.key] === value}
                  onChange={() => onChange(c.key, value)}
                />
                {value ?? clearLabel}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
