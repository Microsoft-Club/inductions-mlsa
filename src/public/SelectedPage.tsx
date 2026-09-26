import { useCallback, useEffect, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { PublishedResult } from '../lib/types.ts';

/** Case, spaces and script don't matter: " 2025 102 " finds 2025102, "ali" finds Ali. */
export function matchesResult(result: PublishedResult, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return result.reg_number.includes(q.replace(/\s+/g, '').toUpperCase()) || result.full_name.toLocaleLowerCase().includes(q.toLocaleLowerCase());
}

/** /selected: the public list of selected candidates, shown only after an admin publishes results. */
export function SelectedPage() {
  const api = useApi();
  const [results, setResults] = useState<PublishedResult[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    setFailed(false);
    api.publishedResults().then(setResults, () => setFailed(true));
  }, [api]);

  useEffect(() => {
    document.title = 'Induction results · Microsoft Club GIKI';
    load();
  }, [load]);

  const shown = (results ?? []).filter((r) => matchesResult(r, query));

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white">
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-12">
        <header className="space-y-1 text-center">
          <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">Microsoft Club GIKI</p>
          {results && results.length > 0 && <h1 className="text-3xl font-bold">Induction results</h1>}
        </header>

        {failed ? (
          <div className="space-y-3 text-center">
            <p className="text-slate-700">Couldn't load the results. Check your connection and try again.</p>
            <button type="button" className={buttonClasses('primary', 'md')} onClick={load}>
              Try again
            </button>
          </div>
        ) : results === null ? (
          <p className="text-center text-slate-500">Loading…</p>
        ) : results.length === 0 ? (
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-bold">Results not announced yet</h1>
            <p className="text-slate-600">Check back after the announcement.</p>
          </div>
        ) : (
          <>
            <p className="text-center text-slate-700">
              Congratulations to everyone selected!{' '}
              <span className="font-medium">
                {results.length} {results.length === 1 ? 'candidate' : 'candidates'} selected
              </span>
            </p>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find your name or reg number"
              aria-label="Find your name or reg number"
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-4 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            />
            {shown.length === 0 ? (
              <p className="text-center text-slate-600">
                No selected candidate matches “{query.trim()}”. Check the spelling, or search by reg number.
              </p>
            ) : (
              <ul aria-label="Selected candidates" className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
                {shown.map((r) => (
                  <li key={r.reg_number} className="flex items-baseline justify-between gap-3 px-4 py-3">
                    <bdi className="font-medium">{r.full_name}</bdi>
                    <span className="font-mono text-sm text-slate-500">{r.reg_number}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
