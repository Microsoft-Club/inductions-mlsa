import { useState } from 'react';
import { ActionButton } from '../components/ActionButton.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { BoardSnapshot } from '../lib/types.ts';
import { ApplicationDialog } from '../panel/ApplicationDialog.tsx';
import { CandidateName } from './bits.tsx';
import { describeLocation, searchCandidates } from './queueView.ts';
import { useCandidates } from './useCandidates.ts';

/** Find anyone by number, name or reg number; check in people who haven't arrived yet. Admins can open the form. */
export function SearchBox({ board, canReadForms = false }: { board: BoardSnapshot; canReadForms?: boolean }) {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const searching = query.trim() !== '';
  const { list, error } = useCandidates(board, searching);

  const results = searching && list ? searchCandidates(list, query) : [];

  return (
    <div className="relative w-full max-w-md">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('');
        }}
        placeholder="Search number, name or reg number"
        aria-label="Search candidates"
        className="h-10 w-full rounded-md border border-slate-300 px-3 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
      />
      {searching && (
        <div className="absolute top-11 right-0 left-0 z-20 max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {error ? (
            <p role="alert" className="px-3 py-2 text-sm text-red-700">{error}</p>
          ) : list === null ? (
            <p className="px-3 py-2 text-sm text-slate-500">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">No candidate matches “{query.trim()}”.</p>
          ) : (
            <ul aria-label="Search results" className="divide-y divide-slate-100">
              {results.map((candidate) => (
                <li key={candidate.id} className="flex items-center gap-3 px-3 py-2">
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
      )}
      {openId && <ApplicationDialog candidateId={openId} onClose={() => setOpenId(null)} fullRecord />}
    </div>
  );
}
