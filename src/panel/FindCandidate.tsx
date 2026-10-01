import { useState } from 'react';
import type { BoardSnapshot } from '../lib/types.ts';
import { CandidateName } from '../queue/bits.tsx';
import { LIST_LABELS } from '../queue/CandidateListDialog.tsx';
import { describeLocation, filterCandidates, LIST_FILTERS, type ListFilter } from '../queue/queueView.ts';
import { useCandidates } from '../queue/useCandidates.ts';
import { ApplicationDialog } from './ApplicationDialog.tsx';

/**
 * Every candidate in number order, narrowed by status or by number, name or reg number. Any of them
 * opens their application, read-only (no chat or evaluation).
 */
export function FindCandidate({ board }: { board: BoardSnapshot }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const { list, error } = useCandidates(board, true);
  const counts: Record<ListFilter, number> = { ...board.counts, all: Object.values(board.counts).reduce((a, b) => a + b, 0) };
  const inList = list ? filterCandidates(list, filter, '') : [];
  const shown = list ? filterCandidates(list, filter, query) : [];

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a candidate by number, name or reg"
        aria-label="Find a candidate"
        className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
      />
      <div className="flex flex-wrap gap-1">
        {LIST_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === filter}
            onClick={() => setFilter(option)}
            className={`rounded-md px-2.5 py-1 text-sm font-medium ${
              option === filter ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {LIST_LABELS[option]} <span className="tabular-nums">{counts[option]}</span>
          </button>
        ))}
      </div>

      <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200">
        {error ? (
          <p role="alert" className="px-3 py-3 text-sm text-red-700">{error}</p>
        ) : list === null ? (
          <p className="px-3 py-3 text-sm text-slate-500">Loading the candidates…</p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-3 text-sm text-slate-500">
            {query.trim() ? `No candidate matches “${query.trim()}”.` : `No ${LIST_LABELS[filter].toLowerCase()} candidates.`}
          </p>
        ) : (
          <ul aria-label="Candidates" className="divide-y divide-slate-100">
            {shown.map((candidate) => (
              <li key={candidate.id} className="px-3 py-2">
                <button type="button" className="block max-w-full text-left text-brand-700 hover:underline" onClick={() => setOpenId(candidate.id)}>
                  <CandidateName number={candidate.number} name={candidate.full_name} className="block font-medium" />
                </button>
                <p className="text-xs text-slate-500">
                  {candidate.reg_number} · {describeLocation(board, candidate)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Showing {shown.length} of {inList.length}
      </p>
      {openId && <ApplicationDialog candidateId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
