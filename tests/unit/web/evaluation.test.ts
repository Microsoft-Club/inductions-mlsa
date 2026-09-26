import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftFromEvaluation, loadDraft, sameAsSaved, saveDraft, validateDraft, type EvaluationDraft } from '../../../src/panel/evaluation.ts';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

describe('evaluation drafts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a draft', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const draft: EvaluationDraft = { scores: { communication: 4 }, recommendation: 'maybe', comments: 'Quiet but thoughtful' };
    saveDraft('k', draft);
    expect(loadDraft('k')).toEqual(draft);
  });

  it('ignores drafts it cannot trust, and storage that refuses to work', () => {
    vi.stubGlobal('localStorage', memoryStorage({ broken: '{not json', wrong: JSON.stringify({ scores: { communication: 9 }, recommendation: 'yes', comments: '' }) }));
    expect(loadDraft('broken')).toBeNull();
    expect(loadDraft('wrong')).toBeNull(); // a score outside 1–5
    expect(loadDraft('missing')).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } });
    expect(loadDraft('k')).toBeNull();
    expect(() => saveDraft('k', draftFromEvaluation())).not.toThrow();
  });
});

describe('validateDraft', () => {
  it('requires only a recommendation, and caps comments at 5000 characters', () => {
    expect(validateDraft({ scores: {}, recommendation: null, comments: '' })).toBe('Choose a recommendation before submitting.');
    expect(validateDraft({ scores: {}, recommendation: 'no', comments: '' })).toBeNull();
    expect(validateDraft({ scores: {}, recommendation: 'yes', comments: 'x'.repeat(5001) })).toBe('Comments must be at most 5000 characters.');
  });
});

describe('sameAsSaved', () => {
  const saved = { interview_id: 'i7', scores: { communication: 4, teamwork: 3 }, recommendation: 'yes' as const, comments: 'Good', updated_at: '2026-09-26T10:07:00Z' };

  it('ignores the order the scores were given in', () => {
    expect(sameAsSaved({ scores: { teamwork: 3, communication: 4 }, recommendation: 'yes', comments: 'Good' }, saved)).toBe(true);
    expect(sameAsSaved({ scores: { teamwork: 3, communication: 5 }, recommendation: 'yes', comments: 'Good' }, saved)).toBe(false);
    expect(sameAsSaved({ scores: { teamwork: 3 }, recommendation: 'yes', comments: 'Good' }, saved)).toBe(false);
    expect(sameAsSaved({ scores: {}, recommendation: null, comments: '' })).toBe(true);
  });
});
