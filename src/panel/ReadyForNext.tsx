import { ActionButton } from '../components/ActionButton.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { useClock } from '../lib/ClockProvider.tsx';
import { elapsedMs } from '../lib/clock.ts';
import type { BoardPanel } from '../lib/types.ts';
import { panelState } from '../queue/queueView.ts';

/** Ready unlocks this long after End (the server checks too), so End then Ready can't be pressed by reflex. */
const READY_AFTER_MS = 15_000;

/** After End, the panel tells the queue desk it is ready for the next person. Nothing during an interview. */
export function ReadyForNext({ panel }: { panel: BoardPanel }) {
  const api = useApi();
  const { nowMs, offsetMs } = useClock();
  const state = panelState(panel); // the same rule as the queue desk's badge
  const last = panel.last_ended;
  if (state === 'busy' || !last) return null;

  if (state === 'ready') {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
        You're ready for the next candidate. The queue desk will send them in.
      </p>
    );
  }

  // Counted on the server's clock from when the interview ended, so every panelist sees the same wait.
  const waitSeconds = Math.ceil((READY_AFTER_MS - elapsedMs(last.ended_at, nowMs, offsetMs)) / 1000);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md bg-amber-50 px-3 py-2">
      <p className="text-sm font-medium text-amber-900">
        The interview with <span className="tabular-nums">#{last.number}</span> <bdi>{last.name}</bdi> has ended.
      </p>
      <ActionButton variant="primary" size="md" disabled={waitSeconds > 0} action={() => api.markPanelReady(last.interview_id)}>
        {waitSeconds > 0 ? `Ready in ${waitSeconds}s` : 'Ready for next candidate'}
      </ActionButton>
    </div>
  );
}
