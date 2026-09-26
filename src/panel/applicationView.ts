import type { Answer, AnswerSection, Candidate } from '../lib/types.ts';

export const SECTION_LABELS: Record<AnswerSection, string> = {
  general: 'General',
  dev: 'Dev',
  logikal: 'LogiKal',
  lnd: 'L&D',
  marketing: 'Marketing',
};

const SECTION_ORDER: AnswerSection[] = ['general', 'dev', 'logikal', 'lnd', 'marketing'];

export interface VisibleSection {
  key: AnswerSection;
  label: string;
  answers: Answer[];
}

/** Sections in form order, each with only its answered questions; sections with none are left out. */
export function visibleSections(candidate: Candidate): VisibleSection[] {
  return SECTION_ORDER.map((key) => ({
    key,
    label: SECTION_LABELS[key],
    answers: (candidate.answers[key] ?? []).filter((answer) => answer.a.trim() !== ''),
  })).filter((section) => section.answers.length > 0);
}

/** Team preferences with their rank; blank ranks are skipped but keep their number. */
export function rankedPreferences(preferences: string[]): Array<{ rank: number; team: string }> {
  return preferences.map((team, i) => ({ rank: i + 1, team: team.trim() })).filter((p) => p.team !== '');
}
