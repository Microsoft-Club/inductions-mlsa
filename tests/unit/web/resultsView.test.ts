import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import type { EvaluationExportRow } from '../../../src/lib/types.ts';
import {
  batchLabel,
  batchOptions,
  candidatesCsv,
  csvFileName,
  evaluationsCsv,
  filterRows,
  formatAverage,
  formatTally,
  safeCell,
  sortRows,
} from '../../../src/results/resultsView.ts';
import { criteriaList, resultRow } from './fixtures.ts';

const rows = [
  resultRow({ candidate_id: 'c7', number: 7, full_name: 'Sara Ahmed', general_avg: 3.75, decision: 'selected', status: 'interviewed' }),
  resultRow({ candidate_id: 'c2', number: 2, full_name: 'Ali Raza', general_avg: null, evaluation_count: 0, decision: 'undecided', status: 'registered', recommendations: {} }),
  resultRow({ candidate_id: 'c9', number: 9, full_name: 'عائشہ خان', reg_number: '2025009', general_avg: 4.5, decision: 'not_selected', status: 'interviewed' }),
];

describe('formatting', () => {
  it('writes the recommendation tally strongest first, and a dash when there is none', () => {
    expect(formatTally({ yes: 3, strong_yes: 1, no: 1 })).toBe('1 Strong Yes · 3 Yes · 1 No');
    expect(formatTally({})).toBe('—');
  });

  it('shows averages to two decimals at most, and a dash for none', () => {
    expect([3.75, 4, 4.5, null].map(formatAverage)).toEqual(['3.75', '4', '4.5', '—']);
  });
});

describe('sortRows and filterRows', () => {
  it('sorts by any column, keeping candidates without scores last either way', () => {
    expect(sortRows(rows, { key: 'general_avg', dir: 'desc' }).map((r) => r.number)).toEqual([9, 7, 2]);
    expect(sortRows(rows, { key: 'general_avg', dir: 'asc' }).map((r) => r.number)).toEqual([7, 9, 2]);
    expect(sortRows(rows, { key: 'number', dir: 'asc' }).map((r) => r.number)).toEqual([2, 7, 9]);
    expect(sortRows(rows, { key: 'full_name', dir: 'asc' }).map((r) => r.number)).toEqual([2, 7, 9]);
    expect(sortRows(rows, { key: 'fit:fit_dev', dir: 'desc' }).map((r) => r.number)).toEqual([2, 7, 9]);
  });

  it('filters by status, decision and a number, name or reg number', () => {
    expect(filterRows(rows, { status: 'interviewed', decision: 'all', query: '', batch: 'all' }).map((r) => r.number)).toEqual([7, 9]);
    expect(filterRows(rows, { status: 'all', decision: 'selected', query: '', batch: 'all' }).map((r) => r.number)).toEqual([7]);
    expect(filterRows(rows, { status: 'all', decision: 'all', query: 'عائشہ', batch: 'all' }).map((r) => r.number)).toEqual([9]);
    expect(filterRows(rows, { status: 'all', decision: 'all', query: '#2', batch: 'all' }).map((r) => r.number)).toEqual([2]);
    expect(filterRows(rows, { status: 'all', decision: 'all', query: '2025009', batch: 'all' }).map((r) => r.number)).toEqual([9]); // a reg number is all digits too
    expect(filterRows(rows, { status: 'all', decision: 'all', query: ' 2025 009 ', batch: 'all' }).map((r) => r.number)).toEqual([9]);
  });

  it('filters by batch', () => {
    const mixed = [
      resultRow({ candidate_id: 'c1', number: 1, reg_number: '2025001', batch: 'B35' }),
      resultRow({ candidate_id: 'c2', number: 2, reg_number: '2026002', batch: 'B36' }),
      resultRow({ candidate_id: 'c3', number: 3, reg_number: '2026003', batch: 'B36' }),
    ];
    const only = (batch: string) => filterRows(mixed, { status: 'all', decision: 'all', query: '', batch }).map((r) => r.number);
    expect(only('B36')).toEqual([2, 3]);
    expect(only('B35')).toEqual([1]);
    expect(only('all')).toEqual([1, 2, 3]);
  });
});

describe('batches', () => {
  it('offers each batch that candidates chose, in order, once', () => {
    const batches = ['B36', 'B35', 'B36', '', 'B35'].map((batch, i) => resultRow({ candidate_id: `c${i}`, number: i + 1, batch }));
    expect(batchOptions(batches)).toEqual(['B35', 'B36']);
  });

  it('names "B35" as Batch 35 and leaves anything else as it was', () => {
    expect(batchLabel('B35')).toBe('Batch 35');
    expect(batchLabel('b36')).toBe('Batch 36');
    expect(batchLabel('Other')).toBe('Other');
  });
});

describe('CSV exports', () => {
  it('neutralises cells a spreadsheet would run as a formula', () => {
    expect(['=HYPERLINK("x")', '+92300', '-1', '@SUM(A1)', 'Ali', 3].map(safeCell)).toEqual([
      '\'=HYPERLINK("x")', "'+92300", "'-1", "'@SUM(A1)", 'Ali', '3',
    ]);
  });

  it('writes one row per candidate with averages, the tally and the decision', () => {
    const parsed = Papa.parse<string[]>(candidatesCsv(rows, criteriaList())).data;
    expect(parsed[0]).toEqual([
      'Number', 'Reg number', 'Name', 'Department', 'Batch', 'Preference 1', 'Preference 2', 'Preference 3', 'Preference 4',
      'Status', 'Evaluations', 'General average', 'Dev', 'LogiKal', 'L&D', 'Marketing', 'Strong Yes', 'Yes', 'Maybe', 'No', 'Decision',
    ]);
    expect(parsed[1]).toEqual([
      '7', '2025007', 'Sara Ahmed', 'Computer Science', 'B35', 'Dev Team', 'Marketing', '', '', 'Interviewed', '2', '3.75',
      '5', '', '', '', '1', '1', '0', '0', 'Selected',
    ]);
    expect(parsed[3][2]).toBe('عائشہ خان');
  });

  it('writes one row per evaluation with every criterion', () => {
    const exported: EvaluationExportRow[] = [{
      number: 7, reg_number: '2025007', full_name: 'Sara Ahmed', panel: 'Panel 1', panelist: 'Hamza',
      scores: { communication: 4, fit_dev: 5 }, recommendation: 'strong_yes', comments: '=cmd', submitted_at: '2026-09-26T10:07:00+00:00', updated_at: '2026-09-26T19:30:05.123+00:00',
    }];
    const parsed = Papa.parse<string[]>(evaluationsCsv(exported, criteriaList())).data;
    expect(parsed[0]).toEqual([
      'Number', 'Reg number', 'Name', 'Panel', 'Panelist', 'Communication', 'Confidence & Attitude', 'Teamwork', 'Commitment',
      'Problem Solving', 'Dev', 'LogiKal', 'L&D', 'Marketing', 'Recommendation', 'Comments', 'Submitted at (PKT)', 'Last changed (PKT)',
    ]);
    expect(parsed[1]).toEqual([
      '7', '2025007', 'Sara Ahmed', 'Panel 1', 'Hamza', '4', '', '', '', '', '5', '', '', '', 'Strong Yes', "'=cmd", '2026-09-26 15:07:00', '2026-09-27 00:30:05',
    ]);
  });

  it('names files after the induction and the date', () => {
    expect(csvFileName('candidates', 'Fall 2026 (MLSA)', new Date(2026, 8, 27))).toBe('fall-2026-mlsa-candidates-2026-09-27.csv');
  });
});
