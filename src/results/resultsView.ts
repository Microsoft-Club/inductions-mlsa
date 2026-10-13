// Pure helpers behind /results: formatting, sorting, filtering and the two CSV exports.
import Papa from 'papaparse';
import type { CandidateStatus, Criterion, Decision, EvaluationExportRow, Recommendation, ResultRow } from '../lib/types.ts';
import { parseServerTime } from '../lib/clock.ts';
import { RECOMMENDATIONS } from '../panel/evaluation.ts';

export const DECISION_LABELS: Record<Decision, string> = {
  undecided: 'Undecided',
  selected: 'Selected',
  not_selected: 'Not selected',
};

export const STATUS_LABELS: Record<CandidateStatus, string> = {
  registered: 'Registered',
  waiting: 'Waiting',
  interviewing: 'Interviewing',
  interviewed: 'Interviewed',
};

const RECOMMENDATION_LABELS = Object.fromEntries(RECOMMENDATIONS.map((r) => [r.value, r.label])) as Record<Recommendation, string>;

/** "1 Strong Yes · 3 Yes", strongest first; "—" when nobody has evaluated. */
export function formatTally(recommendations: ResultRow['recommendations']): string {
  const parts = RECOMMENDATIONS.filter((r) => recommendations[r.value]).map((r) => `${recommendations[r.value]} ${r.label}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function formatAverage(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(Number(value.toFixed(2)));
}

/** Points per vote in the score. The widest gap is between Yes and Maybe, where "take them" turns into "don't". */
export const RECOMMENDATION_POINTS: Record<Recommendation, number> = { strong_yes: 4, yes: 3, maybe: 1, no: 0 };

function votes(recommendations: ResultRow['recommendations']): { count: number; points: number } {
  let count = 0;
  let points = 0;
  for (const r of RECOMMENDATIONS) {
    const n = recommendations[r.value] ?? 0;
    count += n;
    points += n * RECOMMENDATION_POINTS[r.value];
  }
  return { count, points };
}

/** The average points per vote across every candidate in the induction; null before anyone has voted. */
export function averageVotePoints(rows: ResultRow[]): number | null {
  let count = 0;
  let points = 0;
  for (const row of rows) {
    const v = votes(row.recommendations);
    count += v.count;
    points += v.points;
  }
  return count > 0 ? points / count : null;
}

/**
 * The candidate's average points per vote, counting one extra vote at the induction's average, so one
 * panelist's Strong Yes can't outrank a unanimous panel and a bigger panel doesn't win by headcount alone.
 * Rounded as shown, so candidates who look tied are tied; null without votes.
 */
export function candidateScore(row: ResultRow, average: number | null): number | null {
  const { count, points } = votes(row.recommendations);
  if (count === 0 || average === null) return null;
  return Math.round(((points + average) / (count + 1)) * 100) / 100;
}

export type SortKey = 'number' | 'full_name' | 'evaluation_count' | 'general_avg' | 'score' | 'decision' | `fit:${string}`;

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const SORT_KEYS: readonly string[] = ['number', 'full_name', 'evaluation_count', 'general_avg', 'score', 'decision'];
const isSortKey = (key: string): key is SortKey => SORT_KEYS.includes(key) || /^fit:.+/.test(key);

/** A column's first click: number and name A→Z, scores and the decision highest first. */
export function defaultSortDir(key: SortKey): SortState['dir'] {
  return key === 'number' || key === 'full_name' ? 'asc' : 'desc';
}

function sortValue(row: ResultRow, key: SortKey, average: number | null): number | string | null {
  if (key.startsWith('fit:')) return row.criteria_avgs[key.slice(4)] ?? null;
  if (key === 'full_name') return row.full_name.toLocaleLowerCase();
  if (key === 'decision') return DECISION_LABELS[row.decision];
  if (key === 'score') return candidateScore(row, average);
  return row[key as 'number' | 'evaluation_count' | 'general_avg'];
}

/**
 * Sorted by one column; rows without a value (no scores yet) always go last; ties by number, except equal
 * scores, which go by the general average first. `average` is averageVotePoints of the whole table.
 */
export function sortRows(rows: ResultRow[], sort: SortState, average: number | null = null): ResultRow[] {
  const direction = sort.dir === 'asc' ? 1 : -1;
  const compare = (x: number | string | null, y: number | string | null) => {
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return x < y ? -direction : x > y ? direction : 0;
  };
  return [...rows].sort(
    (a, b) =>
      compare(sortValue(a, sort.key, average), sortValue(b, sort.key, average)) ||
      (sort.key === 'score' ? compare(a.general_avg, b.general_avg) : 0) ||
      a.number - b.number,
  );
}

export interface Filters {
  status: CandidateStatus | 'all';
  decision: Decision | 'all';
  /** The batch as candidates chose it on the form (e.g. "B35"), or 'all'. */
  batch: string;
  query: string;
}

export function filterRows(rows: ResultRow[], { status, decision, batch, query }: Filters): ResultRow[] {
  const q = query.trim();
  const exactNumber = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
  const reg = q.replace(/\s+/g, '').toUpperCase();
  const name = q.toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (status === 'all' || row.status === status) &&
      (decision === 'all' || row.decision === decision) &&
      (batch === 'all' || row.batch === batch) &&
      (!q || row.number === exactNumber || row.reg_number.includes(reg) || row.full_name.toLocaleLowerCase().includes(name)),
  );
}

// The table's filters and sort are kept in the address (/results?status=interviewed&sort=general_avg&dir=desc),
// so Back, "← All results" and a reload find it as it was. Defaults are left out of it.

/** The filters in `search`; anything missing or unknown is All. */
export function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const status = params.get('status') ?? '';
  const decision = params.get('decision') ?? '';
  return {
    status: Object.hasOwn(STATUS_LABELS, status) ? (status as CandidateStatus) : 'all',
    decision: Object.hasOwn(DECISION_LABELS, decision) ? (decision as Decision) : 'all',
    batch: params.get('batch') || 'all',
    query: params.get('q') ?? '',
  };
}

/** The sort in `search`; by number when it has none. */
export function readSort(search: string): SortState {
  const params = new URLSearchParams(search);
  const key = params.get('sort') ?? '';
  if (!isSortKey(key)) return { key: 'number', dir: 'asc' };
  const dir = params.get('dir');
  return { key, dir: dir === 'asc' || dir === 'desc' ? dir : defaultSortDir(key) };
}

/** The search part of the address for this table, e.g. "?status=interviewed", or "" for the whole table by number. */
export function resultsSearch(filters: Filters, sort: SortState): string {
  const params = new URLSearchParams();
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.decision !== 'all') params.set('decision', filters.decision);
  if (filters.batch !== 'all') params.set('batch', filters.batch);
  if (filters.query) params.set('q', filters.query);
  if (sort.key !== 'number' || sort.dir !== 'asc') {
    params.set('sort', sort.key);
    params.set('dir', sort.dir);
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

/** Each batch candidates chose on the form, once and in order (blank answers left out). */
export function batchOptions(rows: ResultRow[]): string[] {
  return [...new Set(rows.map((row) => row.batch).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** "B35" → "Batch 35"; any other answer as it is. */
export function batchLabel(batch: string): string {
  const match = /^B(\d+)$/i.exec(batch.trim());
  return match ? `Batch ${match[1]}` : batch;
}

/** Spreadsheets run cells starting with = + - @ as formulas; names and comments come from the public form. */
export function safeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const teamFit = (criteria: Criterion[]) => criteria.filter((c) => c.category === 'team_fit');

/** Export (a): one row per candidate with the summary and the decision. */
export function candidatesCsv(rows: ResultRow[], criteria: Criterion[]): string {
  const fit = teamFit(criteria);
  const header = [
    'Number', 'Reg number', 'Name', 'Department', 'Batch', 'Preference 1', 'Preference 2', 'Preference 3', 'Preference 4',
    'Status', 'Evaluations', 'General average', ...fit.map((c) => c.label), ...RECOMMENDATIONS.map((r) => r.label), 'Decision',
  ];
  const body = rows.map((row) => [
    row.number,
    row.reg_number,
    row.full_name,
    row.department,
    row.batch,
    ...[0, 1, 2, 3].map((i) => row.preferences[i] ?? ''),
    STATUS_LABELS[row.status],
    row.evaluation_count,
    row.general_avg === null ? '' : formatAverage(row.general_avg),
    ...fit.map((c) => (row.criteria_avgs[c.key] === undefined ? '' : formatAverage(row.criteria_avgs[c.key]))),
    ...RECOMMENDATIONS.map((r) => row.recommendations[r.value] ?? 0),
    DECISION_LABELS[row.decision],
  ]);
  return Papa.unparse([header, ...body].map((line) => line.map(safeCell)));
}

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // Pakistan: UTC+5, no daylight saving

/** "2026-09-26 15:07:00" in Pakistan time: what the club reads, and a form spreadsheets take as a date. */
export function pakistanTime(iso: string): string {
  const ms = parseServerTime(iso);
  return Number.isNaN(ms) ? '' : new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

/** Export (b): one row per evaluation, with every criterion as a column. */
export function evaluationsCsv(rows: EvaluationExportRow[], criteria: Criterion[]): string {
  const header = ['Number', 'Reg number', 'Name', 'Panel', 'Panelist', ...criteria.map((c) => c.label), 'Recommendation', 'Comments', 'Submitted at (PKT)', 'Last changed (PKT)'];
  const body = rows.map((row) => [
    row.number,
    row.reg_number,
    row.full_name,
    row.panel,
    row.panelist,
    ...criteria.map((c) => row.scores[c.key] ?? ''),
    RECOMMENDATION_LABELS[row.recommendation],
    row.comments,
    pakistanTime(row.submitted_at),
    pakistanTime(row.updated_at),
  ]);
  return Papa.unparse([header, ...body].map((line) => line.map(safeCell)));
}

export function csvFileName(kind: 'candidates' | 'evaluations', inductionName: string, now = new Date()): string {
  const slug = inductionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'induction';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${slug}-${kind}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
