import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { buttonClasses } from '../components/ActionButton.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import type { Candidate } from '../lib/types.ts';
import { ApplicationTabs } from './ApplicationTabs.tsx';
import { CandidateCard } from './CandidateCard.tsx';

interface ApplicationDialogProps {
  candidateId: string;
  onClose: () => void;
  /** Admins also get a link to the candidate's full record (interviews, discussion, evaluations). */
  fullRecord?: boolean;
}

/** One candidate's application, read-only: from a panelist's search, or an admin's lists and search. */
export function ApplicationDialog({ candidateId, onClose, fullRecord = false }: ApplicationDialogProps) {
  const api = useApi();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.candidate(candidateId).then(
      (row) => current && setCandidate(row),
      (e) => current && setError(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [api, candidateId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const title = candidate ? `Application of #${candidate.number} ${candidate.full_name}` : 'Application';
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-10"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-3xl space-y-3 rounded-xl bg-slate-50 p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {fullRecord && (
            <Link className={`${buttonClasses('secondary')} mr-auto`} to={`/results/${candidateId}`}>
              Full record: interviews, discussion and evaluations
            </Link>
          )}
          <button type="button" className={buttonClasses('ghost')} onClick={onClose}>
            Close
          </button>
        </div>
        {candidate ? (
          <>
            <CandidateCard candidate={candidate} targetMinutes={0} />
            <ApplicationTabs candidate={candidate} />
          </>
        ) : (
          <p role={error ? 'alert' : undefined} className="text-sm text-slate-600">
            {error ?? 'Loading…'}
          </p>
        )}
      </div>
    </div>
  );
}
