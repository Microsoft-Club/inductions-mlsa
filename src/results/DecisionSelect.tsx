import { useState } from 'react';
import { useRunAction } from '../components/ActionProvider.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { Decision } from '../lib/types.ts';
import { DECISION_LABELS } from './resultsView.ts';

interface DecisionSelectProps {
  candidateId: string;
  number: number;
  name: string;
  decision: Decision;
}

/** Undecided / Selected / Not selected. Shows the choice at once; the reload that follows confirms it. */
export function DecisionSelect({ candidateId, number, name, decision }: DecisionSelectProps) {
  const api = useApi();
  const run = useRunAction();
  const [chosen, setChosen] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);
  const value = pending && chosen ? chosen : decision;

  async function change(next: Decision) {
    setChosen(next);
    setPending(true);
    await run(() => api.setDecision(candidateId, next));
    setPending(false);
  }

  return (
    <select
      aria-label={`Decision for #${number} ${name}`}
      value={value}
      disabled={pending}
      onChange={(e) => void change(e.target.value as Decision)}
      className={`h-8 rounded-md border px-2 text-sm ${
        value === 'selected' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : value === 'not_selected' ? 'border-slate-300 bg-slate-100' : 'border-slate-300 bg-white'
      }`}
    >
      {(Object.keys(DECISION_LABELS) as Decision[]).map((d) => (
        <option key={d} value={d}>
          {DECISION_LABELS[d]}
        </option>
      ))}
    </select>
  );
}
