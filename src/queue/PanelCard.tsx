import { ActionButton } from '../components/ActionButton.tsx';
import { Timer } from '../components/Timer.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { useClock } from '../lib/ClockProvider.tsx';
import { elapsedMs, formatElapsed } from '../lib/clock.ts';
import type { BoardPanel, Role } from '../lib/types.ts';
import { CandidateName, MoveButtons, SkipBadge } from './bits.tsx';
import { NoPhotoButton, usePhotoFlow } from './PhotoFlow.tsx';
import { canDeletePanel, notReadyConfirm, panelState, type PanelState } from './queueView.ts';

const BADGES: Record<PanelState, { text: string; className: string }> = {
  busy: { text: 'Busy', className: 'bg-sky-100 text-sky-800' },
  wrapping_up: { text: 'Wrapping up', className: 'bg-amber-100 text-amber-900' },
  ready: { text: 'Ready', className: 'bg-emerald-100 text-emerald-800' },
};

interface PanelCardProps {
  panel: BoardPanel;
  targetMinutes: number;
  role: Role;
}

export function PanelCard({ panel, targetMinutes, role }: PanelCardProps) {
  const api = useApi();
  const { sendIn } = usePhotoFlow();
  const { current, last_ended: lastEnded } = panel;
  const state = panelState(panel);

  return (
    <section aria-label={panel.name} className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-semibold">{panel.name}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGES[state].className}`}>{BADGES[state].text}</span>
        {canDeletePanel(panel, role) && (
          <ActionButton
            variant="ghost"
            className="ml-auto"
            confirm={`Delete ${panel.name}? Anyone lined up for it moves to the end of the pool.`}
            action={() => api.deletePanel(panel.id)}
          >
            Delete panel
          </ActionButton>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        {current ? (
          <div className="rounded-lg bg-sky-50 p-3">
            <p className="text-xs font-semibold tracking-wide text-sky-700 uppercase">Now interviewing</p>
            <p className="mt-1 flex items-baseline justify-between gap-3">
              <CandidateName number={current.number} name={current.name} className="text-lg font-semibold" />
              <Timer startedAt={current.started_at} targetMinutes={targetMinutes} className="text-lg font-semibold" />
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ActionButton
                variant="primary"
                confirm={`End the interview with #${current.number} ${current.name} in ${panel.name}?`}
                action={() => api.endInterview(current.interview_id)}
              >
                End interview
              </ActionButton>
              <ActionButton action={() => api.undoSendIn(current.interview_id)}>Undo send-in</ActionButton>
            </div>
          </div>
        ) : lastEnded ? (
          <>
            {state === 'wrapping_up' && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">
                  Ended <EndedAgo endedAt={lastEnded.ended_at} /> ago
                </p>
                <p>Waiting for the panel to say they're ready for the next person.</p>
              </div>
            )}
            <p className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
              Last: <CandidateName number={lastEnded.number} name={lastEnded.name} /> —
              <ActionButton variant="ghost" label={`Reopen the interview with #${lastEnded.number}`} action={() => api.reopenInterview(lastEnded.interview_id)}>
                Reopen
              </ActionButton>
            </p>
          </>
        ) : null}

        <p className="text-sm text-slate-600">
          {panel.panelists.length > 0 ? `Present: ${panel.panelists.map((p) => p.display_name).join(', ')}` : 'No panelists present'}
        </p>

        {panel.lane.length === 0 ? (
          <p className="text-sm text-slate-500">Nobody lined up.</p>
        ) : (
          <ol aria-label={`Lined up for ${panel.name}`} className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {panel.lane.map((entry) => (
              <li key={entry.candidate_id} className="space-y-2 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 text-sm text-slate-500 tabular-nums">{entry.position}.</span>
                  <CandidateName number={entry.number} name={entry.name} className="flex-1 font-medium" />
                  {!entry.has_photo && <NoPhotoButton entry={entry} />}
                  <SkipBadge count={entry.skip_count} />
                </div>
                <div className="flex flex-wrap gap-1 pl-7">
                  {entry.position === 1 && !current && (
                    <ActionButton
                      variant="primary"
                      label={`Send #${entry.number} in to ${panel.name}`}
                      confirm={notReadyConfirm(panel, entry.number)}
                      action={() => sendIn(entry, panel)}
                    >
                      Send in
                    </ActionButton>
                  )}
                  <MoveButtons entry={entry} laneId={panel.id} laneLength={panel.lane.length} />
                  <ActionButton label={`Skip #${entry.number}`} action={() => api.skipCandidate(entry.candidate_id)}>Skip</ActionButton>
                  <ActionButton label={`Move #${entry.number} back to the pool`} action={() => api.moveCandidate(entry.candidate_id, null, 1)}>
                    Back to pool
                  </ActionButton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** How long ago the interview ended, on the server's clock. */
function EndedAgo({ endedAt }: { endedAt: string }) {
  const { nowMs, offsetMs } = useClock();
  return <span className="tabular-nums">{formatElapsed(elapsedMs(endedAt, nowMs, offsetMs))}</span>;
}
