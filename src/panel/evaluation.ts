// The evaluation form's data: drafts kept on this device, validation, and the submitted shape.
import type { MyEvaluation, Recommendation, Scores } from '../lib/types.ts';

export interface EvaluationDraft {
  scores: Scores;
  recommendation: Recommendation | null;
  comments: string;
}

export const RECOMMENDATIONS: Array<{ value: Recommendation; label: string }> = [
  { value: 'strong_yes', label: 'Strong Yes' },
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
];

export const MAX_COMMENTS = 5000;

export function draftFromEvaluation(saved?: MyEvaluation): EvaluationDraft {
  return saved
    ? { scores: { ...saved.scores }, recommendation: saved.recommendation, comments: saved.comments }
    : { scores: {}, recommendation: null, comments: '' };
}

/** Per person and interview, so panelists sharing a laptop never see each other's drafts. */
export function draftKey(userId: string, interviewId: string): string {
  return `induction:evaluation-draft:${userId}:${interviewId}`;
}

function isDraft(value: unknown): value is EvaluationDraft {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  const scoresOk =
    typeof d.scores === 'object' &&
    d.scores !== null &&
    Object.values(d.scores).every((v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5);
  const recommendationOk = d.recommendation === null || RECOMMENDATIONS.some((r) => r.value === d.recommendation);
  return scoresOk && recommendationOk && typeof d.comments === 'string';
}

/** The saved draft, or null if there is none, it is damaged, or storage is unavailable (private mode). */
export function loadDraft(key: string): EvaluationDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, draft: EvaluationDraft): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the form still works, the draft just won't survive a reload.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

export function sameAsSaved(draft: EvaluationDraft, saved?: MyEvaluation): boolean {
  return JSON.stringify(draft) === JSON.stringify(draftFromEvaluation(saved));
}

/** Only the recommendation is required (spec §5); scores may be left blank. */
export function validateDraft(draft: EvaluationDraft): string | null {
  if (!draft.recommendation) return 'Choose a recommendation before submitting.';
  if (draft.comments.length > MAX_COMMENTS) return `Comments must be at most ${MAX_COMMENTS} characters.`;
  return null;
}
