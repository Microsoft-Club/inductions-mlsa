import { useMemo } from 'react';
import { ActionButton } from '../components/ActionButton.tsx';
import { ActionProvider } from '../components/ActionProvider.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { useLiveSnapshot } from '../lib/useLiveSnapshot.ts';

/**
 * Admins can add panels, delete any panel (including Panel 1 and Panel 2), and take someone out of a
 * panel when they forgot to leave it.
 */
export function PanelsSection() {
  const api = useApi();
  const subscribe = useMemo(() => api.subscribeBoard(), [api]);
  const { data: board, error, reload } = useLiveSnapshot(api.boardSnapshot, subscribe);

  return (
    <section aria-labelledby="panels-title" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 id="panels-title" className="font-semibold">Panels</h2>
        <ActionProvider onSettled={reload}>
          <ActionButton variant="primary" action={() => api.addPanel()}>
            + Add panel
          </ActionButton>
        </ActionProvider>
      </div>
      {error && !board && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {board && (
        <ActionProvider onSettled={reload}>
          <ul className="divide-y divide-slate-100">
            {board.panels.map((panel) => (
              <li key={panel.id} className="space-y-1 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{panel.name}</span>
                  <span className="text-slate-500">
                    {panel.current ? 'Busy' : 'Free'} · {panel.panelists.length} {panel.panelists.length === 1 ? 'panelist' : 'panelists'} ·{' '}
                    {panel.lane.length} lined up
                  </span>
                  <ActionButton
                    variant="ghost"
                    className="ml-auto"
                    label={`Delete ${panel.name}`}
                    confirm={`Delete ${panel.name}? Anyone lined up for it moves to the end of the pool.`}
                    action={() => api.deletePanel(panel.id)}
                  >
                    Delete
                  </ActionButton>
                </div>
                {panel.panelists.length > 0 && (
                  <ul aria-label={`In ${panel.name}`} className="flex flex-wrap gap-2 pl-3">
                    {panel.panelists.map((person) => (
                      <li key={person.id} className="flex items-center gap-1 rounded-md bg-slate-100 py-0.5 pr-0.5 pl-2.5 text-slate-700">
                        <bdi>{person.display_name}</bdi>
                        <ActionButton
                          variant="ghost"
                          className="h-7 px-2"
                          label={`Remove ${person.display_name} from ${panel.name}`}
                          confirm={
                            panel.current
                              ? `Remove ${person.display_name} from ${panel.name}? The interview with #${panel.current.number} ${panel.current.name} is still on.`
                              : undefined
                          }
                          action={() => api.removeFromPanel(person.id)}
                        >
                          Remove
                        </ActionButton>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </ActionProvider>
      )}
    </section>
  );
}
