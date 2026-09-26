import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider, useRunAction } from '../components/ActionProvider.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import type { CandidateStatus, Criterion, Decision, InductionSettings, ResultRow } from '../lib/types.ts';
import { rankedPreferences } from '../panel/applicationView.ts';
import { DecisionSelect } from './DecisionSelect.tsx';
import { downloadCsv } from './download.ts';
import {
  candidatesCsv,
  csvFileName,
  DECISION_LABELS,
  evaluationsCsv,
  filterRows,
  formatAverage,
  formatTally,
  sortRows,
  STATUS_LABELS,
  type Filters,
  type SortKey,
  type SortState,
} from './resultsView.ts';

/** /results: every candidate's evaluations summed up, decisions, exports and publishing (admins). */
export function ResultsPage() {
  const api = useApi();
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [induction, setInduction] = useState<InductionSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ status: 'all', decision: 'all', query: '' });
  const [sort, setSort] = useState<SortState>({ key: 'number', dir: 'asc' });

  const load = useCallback(async () => {
    try {
      const [table, settings] = await Promise.all([api.resultsTable(), api.induction()]);
      setRows(table);
      setInduction(settings);
      setError(null);
      setCriteria(await api.criteria(settings.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api]);

  useEffect(() => {
    document.title = 'Results · MLSA Induction';
    void load();
  }, [load]);

  if (!rows || !induction) {
    return (
      <FullPageMessage title={error ? "Couldn't load the results" : 'Loading the results…'}>
        {error && (
          <>
            <p>{error}</p>
            <button type="button" className={`${buttonClasses('secondary', 'md')} mt-3`} onClick={() => void load()}>
              Try again
            </button>
          </>
        )}
      </FullPageMessage>
    );
  }

  const fit = criteria.filter((c) => c.category === 'team_fit');
  const shown = sortRows(filterRows(rows, filters), sort);
  const decided = (d: Decision) => rows.filter((r) => r.decision === d).length;
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'number' || key === 'full_name' ? 'asc' : 'desc' }));

  return (
    <ActionProvider onSettled={() => void load()}>
      <main className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Results · {induction.name}</h1>
          <span className="text-sm text-slate-600">
            {decided('selected')} selected · {decided('not_selected')} not selected · {decided('undecided')} undecided
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={buttonClasses('ghost', 'md')} onClick={() => void load()}>
              Refresh
            </button>
            <ExportButtons rows={rows} criteria={criteria} inductionName={induction.name} />
            <PublishControl published={induction.results_published} />
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            Couldn't refresh: {error}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="font-medium">
            Status
            <select
              className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as CandidateStatus | 'all' }))}
            >
              <option value="all">All</option>
              {(Object.keys(STATUS_LABELS) as CandidateStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="font-medium">
            Decision
            <select
              className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2"
              value={filters.decision}
              onChange={(e) => setFilters((f) => ({ ...f, decision: e.target.value as Decision | 'all' }))}
            >
              <option value="all">All</option>
              {(Object.keys(DECISION_LABELS) as Decision[]).map((d) => (
                <option key={d} value={d}>
                  {DECISION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="font-medium">
            Find
            <input
              type="search"
              className="mt-1 block h-9 w-64 rounded-md border border-slate-300 px-2 font-normal"
              placeholder="Number, name or reg number"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            />
          </label>
          <span className="pb-2 text-slate-500">
            Showing {shown.length} of {rows.length}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table aria-label="Results" className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 [&_th]:font-medium">
              <tr>
                <SortHeader label="#" sortKey="number" sort={sort} onSort={sortBy} />
                <SortHeader label="Name" sortKey="full_name" sort={sort} onSort={sortBy} />
                <th className="px-3 py-2">Preferences</th>
                <th className="px-3 py-2">Status</th>
                <SortHeader label="Evals" sortKey="evaluation_count" sort={sort} onSort={sortBy} />
                <SortHeader label="General avg" sortKey="general_avg" sort={sort} onSort={sortBy} />
                {fit.map((c) => (
                  <SortHeader key={c.key} label={c.label} sortKey={`fit:${c.key}`} sort={sort} onSort={sortBy} />
                ))}
                <th className="px-3 py-2">Recommendations</th>
                <SortHeader label="Decision" sortKey="decision" sort={sort} onSort={sortBy} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((row) => (
                <tr key={row.candidate_id}>
                  <td className="px-3 py-2 tabular-nums">#{row.number}</td>
                  <td className="px-3 py-2">
                    <Link className="font-medium text-brand-700 hover:underline" to={`/results/${row.candidate_id}`}>
                      <bdi>{row.full_name}</bdi>
                    </Link>
                    <div className="text-xs text-slate-500">{row.reg_number}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {rankedPreferences(row.preferences).map((p) => `${p.rank}. ${p.team}`).join(' · ')}
                  </td>
                  <td className="px-3 py-2">{STATUS_LABELS[row.status]}</td>
                  <td className="px-3 py-2 tabular-nums">{row.evaluation_count}</td>
                  <td className="px-3 py-2 font-medium tabular-nums">{formatAverage(row.general_avg)}</td>
                  {fit.map((c) => (
                    <td key={c.key} className="px-3 py-2 tabular-nums">
                      {formatAverage(row.criteria_avgs[c.key])}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs">{formatTally(row.recommendations)}</td>
                  <td className="px-3 py-2">
                    <DecisionSelect candidateId={row.candidate_id} number={row.number} name={row.full_name} decision={row.decision} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </ActionProvider>
  );
}

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: SortState; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey;
  return (
    <th className="px-3 py-2" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="font-medium hover:text-slate-900" onClick={() => onSort(sortKey)}>
        {label}
        {active && <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  );
}

function ExportButtons({ rows, criteria, inductionName }: { rows: ResultRow[]; criteria: Criterion[]; inductionName: string }) {
  const api = useApi();
  const run = useRunAction();
  return (
    <>
      <button
        type="button"
        className={buttonClasses('secondary', 'md')}
        onClick={() => downloadCsv(csvFileName('candidates', inductionName), candidatesCsv(rows, criteria))}
      >
        Export candidates
      </button>
      <button
        type="button"
        className={buttonClasses('secondary', 'md')}
        onClick={() =>
          void run(async () => downloadCsv(csvFileName('evaluations', inductionName), evaluationsCsv(await api.evaluationsExport(), criteria)))
        }
      >
        Export evaluations
      </button>
    </>
  );
}

function PublishControl({ published }: { published: boolean }) {
  const api = useApi();
  if (!published) {
    return (
      <ActionButton
        variant="primary"
        size="md"
        confirm="Publish results? Everyone marked Selected appears on the public page, and panelists can no longer change their evaluations."
        action={() => api.setResultsPublished(true)}
      >
        Publish results
      </ActionButton>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-semibold text-emerald-800">Published</span>
      <Link className={buttonClasses('ghost', 'md')} to="/selected" target="_blank">
        Open the public page
      </Link>
      <ActionButton
        size="md"
        confirm="Unpublish results? The public page goes back to “Results not announced yet”, and panelists can edit evaluations again."
        action={() => api.setResultsPublished(false)}
      >
        Unpublish
      </ActionButton>
    </span>
  );
}
