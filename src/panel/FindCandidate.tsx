import { useEffect, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import type { BoardSnapshot, Candidate } from '../lib/types.ts';
import { searchCandidates } from '../queue/queueView.ts';
import { useCandidates } from '../queue/useCandidates.ts';
import { ApplicationTabs } from './ApplicationTabs.tsx';
import { CandidateCard } from './CandidateCard.tsx';

/** Search any candidate and read their application (read-only, no chat or evaluation). */
export function FindCandidate({ board }: { board: BoardSnapshot }) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const searching = query.trim() !== '';
  const { list } = useCandidates(board, searching);
  const results = searching && list ? searchCandidates(list, query, 8) : [];

  return (
    <div className="relative w-full max-w-sm">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a candidate by number, name or reg"
        aria-label="Find a candidate"
        className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
      />
      {searching && list && (
        <ul className="absolute top-11 right-0 left-0 z-20 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No candidate matches “{query.trim()}”.</li>}
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  setOpenId(c.id);
                  setQuery('');
                }}
              >
                <span className="tabular-nums">#{c.number}</span> <bdi>{c.full_name}</bdi>
                <span className="ml-2 text-xs text-slate-500">{c.reg_number}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && <ApplicationDialog candidateId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ApplicationDialog({ candidateId, onClose }: { candidateId: string; onClose: () => void }) {
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
        <div className="flex justify-end">
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
