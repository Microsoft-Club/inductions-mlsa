// Pure helpers behind /results: formatting, sorting, filtering and the two CSV exports.
import Papa from 'papaparse';
import type { CandidateStatus, Criterion, Decision, EvaluationExportRow, Recommendation, ResultRow } from '../lib/types.ts';
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

export type SortKey = 'number' | 'full_name' | 'evaluation_count' | 'general_avg' | 'decision' | `fit:${string}`;

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

function sortValue(row: ResultRow, key: SortKey): number | string | null {
  if (key.startsWith('fit:')) return row.criteria_avgs[key.slice(4)] ?? null;
  if (key === 'full_name') return row.full_name.toLocaleLowerCase();
  if (key === 'decision') return DECISION_LABELS[row.decision];
  return row[key as 'number' | 'evaluation_count' | 'general_avg'];
}

/** Sorted by one column; rows without a value (no scores yet) always go last; ties by number. */
export function sortRows(rows: ResultRow[], sort: SortState): ResultRow[] {
  const direction = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    if (x === null || y === null) return x === y ? a.number - b.number : x === null ? 1 : -1;
    if (x < y) return -direction;
    if (x > y) return direction;
    return a.number - b.number;
  });
}

export interface Filters {
  status: CandidateStatus | 'all';
  decision: Decision | 'all';
  query: string;
}

export function filterRows(rows: ResultRow[], { status, decision, query }: Filters): ResultRow[] {
  const q = query.trim();
  const exactNumber = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
  const reg = q.replace(/\s+/g, '').toUpperCase();
  const name = q.toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (status === 'all' || row.status === status) &&
      (decision === 'all' || row.decision === decision) &&
      (!q || row.number === exactNumber || row.reg_number.includes(reg) || row.full_name.toLocaleLowerCase().includes(name)),
  );
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

/** Export (b): one row per evaluation, with every criterion as a column. */
export function evaluationsCsv(rows: EvaluationExportRow[], criteria: Criterion[]): string {
  const header = ['Number', 'Reg number', 'Name', 'Panel', 'Panelist', ...criteria.map((c) => c.label), 'Recommendation', 'Comments', 'Submitted at'];
  const body = rows.map((row) => [
    row.number,
    row.reg_number,
    row.full_name,
    row.panel,
    row.panelist,
    ...criteria.map((c) => row.scores[c.key] ?? ''),
    RECOMMENDATION_LABELS[row.recommendation],
    row.comments,
    row.submitted_at,
  ]);
  return Papa.unparse([header, ...body].map((line) => line.map(safeCell)));
}

export function csvFileName(kind: 'candidates' | 'evaluations', inductionName: string, now = new Date()): string {
  const slug = inductionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'induction';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${slug}-${kind}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
