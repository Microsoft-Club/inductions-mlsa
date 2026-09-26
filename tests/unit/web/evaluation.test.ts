import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftFromEvaluation, loadDraft, saveDraft, validateDraft, type EvaluationDraft } from '../../../src/panel/evaluation.ts';

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
