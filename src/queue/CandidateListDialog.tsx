import { useEffect, useState } from 'react';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { BoardSnapshot } from '../lib/types.ts';
import { ApplicationDialog } from '../panel/ApplicationDialog.tsx';
import { CandidateName } from './bits.tsx';
import { describeLocation, filterCandidates, LIST_FILTERS, type ListFilter } from './queueView.ts';
import { useCandidates } from './useCandidates.ts';

export const LIST_LABELS: Record<ListFilter, string> = {
  registered: 'Registered',
  waiting: 'Waiting',
  interviewing: 'Interviewing',
  interviewed: 'Interviewed',
  all: 'All',
};

interface CandidateListDialogProps {
  board: BoardSnapshot;
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
  onClose: () => void;
  /** Admins can open anyone's full form from the list. */
  canReadForms?: boolean;
}

/** Everyone with one status (or everyone), in number order: opened from the counts in the top bar. */
export function CandidateListDialog({ board, filter, onFilterChange, onClose, canReadForms = false }: CandidateListDialogProps) {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const { list, error } = useCandidates(board, true);
  const counts: Record<ListFilter, number> = { ...board.counts, all: Object.values(board.counts).reduce((a, b) => a + b, 0) };
  const inList = list ? filterCandidates(list, filter, '') : [];
  const shown = list ? filterCandidates(list, filter, query) : [];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !openId) onClose(); // with a form open on top, Escape closes just the form
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, openId]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-10"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="candidate-list-title" className="flex max-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="space-y-3 border-b border-slate-100 p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 id="candidate-list-title" className="text-lg font-semibold">Candidates</h2>
            <button type="button" className={buttonClasses('ghost')} onClick={onClose}>
              Close
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {LIST_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === filter}
                onClick={() => onFilterChange(option)}
                className={`rounded-md px-2.5 py-1 text-sm font-medium ${
                  option === filter ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {LIST_LABELS[option]} <span className="tabular-nums">{counts[option]}</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by number, name or reg number"
            aria-label="Filter candidates"
            autoFocus
            className="h-10 w-full rounded-md border border-slate-300 px-3 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <p role="alert" className="px-5 py-4 text-sm text-red-700">{error}</p>
          ) : list === null ? (
            <p className="px-5 py-4 text-sm text-slate-500">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">
              {query.trim() ? `No candidate matches “${query.trim()}”.` : `No ${LIST_LABELS[filter].toLowerCase()} candidates.`}
            </p>
          ) : (
            <ul aria-label="Candidates" className="divide-y divide-slate-100">
              {shown.map((candidate) => (
                <li key={candidate.id} className="flex items-center gap-3 px-5 py-2">
                  <div className="min-w-0 flex-1">
                    {canReadForms ? (
                      <button type="button" className="block max-w-full text-left text-brand-700 hover:underline" onClick={() => setOpenId(candidate.id)}>
                        <CandidateName number={candidate.number} name={candidate.full_name} className="block font-medium" />
                      </button>
                    ) : (
                      <CandidateName number={candidate.number} name={candidate.full_name} className="block font-medium" />
                    )}
                    <p className="text-xs text-slate-500">
                      {candidate.reg_number} · {describeLocation(board, candidate)}
                    </p>
                  </div>
                  {candidate.status === 'registered' && (
                    <ActionButton variant="primary" label={`Check in #${candidate.number}`} action={() => api.checkIn(candidate.id)}>
                      Check in
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">
          Showing {shown.length} of {inList.length}
        </p>
      </div>
      {openId && <ApplicationDialog candidateId={openId} onClose={() => setOpenId(null)} fullRecord />}
    </div>
  );
}
