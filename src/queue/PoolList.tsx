import { useState } from 'react';
import { ActionButton } from '../components/ActionButton.tsx';
import { useRunAction } from '../components/ActionProvider.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { BoardPanel, BoardSnapshot, LaneEntry } from '../lib/types.ts';
import { CandidateName, MoveButtons, SkipBadge } from './bits.tsx';
import { NoPhotoButton, usePhotoFlow } from './PhotoFlow.tsx';
import { freePanels, notReadyConfirm, poolHint } from './queueView.ts';

/** The waiting pool: everyone checked in who isn't lined up for a panel yet. */
export function PoolList({ board }: { board: BoardSnapshot }) {
  const api = useApi();
  const { sendIn } = usePhotoFlow();
  const hint = poolHint(board);
  const free = freePanels(board);
  const { pool } = board;

  return (
    <section aria-labelledby="pool-title" className="self-start rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
        <h2 id="pool-title" className="text-base font-semibold">Waiting pool</h2>
        <span className="text-sm text-slate-500">{pool.length} waiting</span>
      </header>
      {pool.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Nobody is waiting. Check people in from the search box.</p>
      ) : (
        <ol aria-label="Waiting pool" className="divide-y divide-slate-100">
          {pool.map((entry) => {
            const hinted = hint?.candidateId === entry.candidate_id;
            return (
              <li key={entry.candidate_id} className={`space-y-2 px-4 py-3 ${hinted ? 'bg-emerald-50 ring-2 ring-emerald-400 ring-inset' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="w-5 text-sm text-slate-500 tabular-nums">{entry.position}.</span>
                  <CandidateName number={entry.number} name={entry.name} className="flex-1 font-medium" />
                  {!entry.has_photo && <NoPhotoButton entry={entry} />}
                  <SkipBadge count={entry.skip_count} />
                </div>
                <div className="flex flex-wrap items-center gap-1 pl-7">
                  {free.map((panel) => (
                    <ActionButton
                      key={panel.id}
                      variant={hinted && hint?.panelId === panel.id ? 'primary' : 'secondary'}
                      confirm={notReadyConfirm(panel, entry.number)}
                      action={() => sendIn(entry, panel)}
                    >
                      Send in → {panel.name}
                    </ActionButton>
                  ))}
                  <LineUpSelect entry={entry} panels={board.panels} />
                  <MoveButtons entry={entry} laneId={null} laneLength={pool.length} />
                  <ActionButton label={`Skip #${entry.number}`} action={() => api.skipCandidate(entry.candidate_id)}>Skip</ActionButton>
                  <ActionButton
                    variant="danger"
                    label={`Undo check-in for #${entry.number}`}
                    confirm={`Undo check-in for #${entry.number} ${entry.name}? They leave the queue and lose their place.`}
                    action={() => api.undoCheckIn(entry.candidate_id)}
                  >
                    Undo check-in
                  </ActionButton>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** "Line up for ▾": moves the person to the end of the chosen panel's lane. */
function LineUpSelect({ entry, panels }: { entry: LaneEntry; panels: BoardPanel[] }) {
  const api = useApi();
  const run = useRunAction();
  const [pending, setPending] = useState(false);

  async function lineUp(panelId: string) {
    if (!panelId || pending) return;
    setPending(true);
    await run(() => api.moveCandidate(entry.candidate_id, panelId, null));
    setPending(false);
  }

  return (
    <select
      aria-label={`Line up #${entry.number} for a panel`}
      value=""
      disabled={pending || panels.length === 0}
      onChange={(e) => void lineUp(e.target.value)}
      className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm disabled:opacity-50"
    >
      <option value="">Line up for…</option>
      {panels.map((panel) => (
        <option key={panel.id} value={panel.id}>
          {panel.name}
        </option>
      ))}
    </select>
  );
}
