import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Timer } from '../components/Timer.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { DisplayPanel, DisplayPerson } from '../lib/types.ts';
import { useLiveSnapshot, type LiveStatus } from '../lib/useLiveSnapshot.ts';
import { displayColumns, displayRows, newlySentIn, selectPanels } from './displayView.ts';

const RESYNC_MS = 30_000; // safety net on top of realtime
const FLASH_MS = 5_000;

/** /display?key=…[&panel=<id>]: the projector. No login; never shows an error page. */
export function DisplayPage() {
  const [params] = useSearchParams();
  const key = params.get('key')?.trim() ?? '';

  useEffect(() => {
    document.title = 'Projector · MLSA Induction';
  }, []);

  if (!key) return <InvalidLink />;
  return <DisplayBoard key={key} displayKey={key} panelId={params.get('panel')} />;
}

function DisplayBoard({ displayKey, panelId }: { displayKey: string; panelId: string | null }) {
  const api = useApi();
  const load = useCallback(() => api.displaySnapshot(displayKey), [api, displayKey]);
  // A broadcast only means "something changed": we re-read display_snapshot instead of trusting the
  // payload, because anyone who knows the projector link could send messages on its public channel.
  const subscribe = useMemo(() => api.subscribeDisplay(displayKey), [api, displayKey]);
  const { data, status } = useLiveSnapshot(load, subscribe, RESYNC_MS);
  const flashing = useFlash(data?.panels);

  if (data === null) return <InvalidLink />;
  if (data === undefined) {
    return (
      <Screen status={status}>
        <p className="m-auto text-[3vw] text-slate-500">Connecting…</p>
      </Screen>
    );
  }

  const panels = selectPanels(data.panels, panelId);
  const single = panelId !== null && panels.length === 1;
  const compact = !single && displayRows(panels.length) > 1;
  return (
    <Screen status={status}>
      <header className="px-[3vw] pt-[2vw]">
        <h1 className="text-[2vw] font-semibold text-slate-400">{data.induction_name} · Inductions</h1>
      </header>
      <div
        className="grid min-h-0 flex-1 gap-[1.5vw] px-[3vw] py-[1.5vw]"
        style={{
          gridTemplateColumns: `repeat(${displayColumns(panels.length)}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${displayRows(panels.length)}, minmax(0, 1fr))`,
        }}
      >
        {panels.map((panel) => (
          <PanelTile
            key={panel.id}
            panel={panel}
            targetMinutes={data.target_interview_minutes}
            flash={flashing.includes(panel.id)}
            size={single ? 'large' : compact ? 'compact' : 'normal'}
          />
        ))}
      </div>
      {!single && <WaitingStrip people={data.waiting} />}
    </Screen>
  );
}

function Screen({ status, children }: { status: LiveStatus; children: ReactNode }) {
  const live = status === 'live';
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-white">
      {children}
      <span
        role="status"
        aria-label={live ? 'Live' : 'Reconnecting'}
        title={live ? 'Live' : 'Reconnecting'}
        className={`fixed right-3 bottom-3 size-3 rounded-full ${live ? 'bg-emerald-500' : 'animate-pulse bg-amber-400'}`}
      />
    </div>
  );
}

/**
 * Text sizes per tile size. Each is the screen-width size it always had, capped by the tile's own
 * height (cqh: the tile is a size container), so short tiles shrink their text instead of spilling it
 * over the next tile and the waiting strip. The caps are worked out so the longest name allowed
 * (`clamp`), the timer and the line-up always fit; with 1–3 panels the tiles are tall and the caps
 * don't bind.
 */
const SIZES = {
  // One panel full screen (&panel=): the whole width, so two lines hold any name.
  large: { label: 'text-[length:min(1.8vw,6cqh)]', now: 'text-[length:min(1.4vw,4.5cqh)]', name: 'text-[length:min(7vw,13cqh)]', clamp: 'line-clamp-2', timer: 'text-[length:min(5vw,10cqh)]' },
  // 1–3 panels side by side: narrow, tall tiles.
  normal: { label: 'text-[length:min(1.8vw,6cqh)]', now: 'text-[length:min(1.4vw,4.5cqh)]', name: 'text-[length:min(3.6vw,9.7cqh)]', clamp: 'line-clamp-3', timer: 'text-[length:min(3vw,9cqh)]' },
  // Two or more rows (4+ panels): short, wide tiles; the line-up is one line of two names.
  compact: { label: 'text-[length:min(1.8vw,7cqh)]', now: 'text-[length:min(1.4vw,5cqh)]', name: 'text-[length:min(3.6vw,14cqh)]', clamp: 'line-clamp-2', timer: 'text-[length:min(3vw,12cqh)]' },
} as const;

/** One panel. Long names stop at the size's line limit, and the tile clips anything that still doesn't fit. */
function PanelTile({ panel, targetMinutes, flash, size }: { panel: DisplayPanel; targetMinutes: number; flash: boolean; size: keyof typeof SIZES }) {
  const text = SIZES[size];
  return (
    <section
      aria-label={panel.name}
      data-flash={flash ? 'true' : undefined}
      className={`min-h-0 overflow-hidden rounded-[1.2vw] border transition-colors duration-700 [container-type:size] ${
        flash ? 'border-amber-300 bg-amber-400/20' : 'border-slate-800 bg-slate-900'
      }`}
    >
      <div className="flex h-full min-h-0 flex-col p-[min(2vw,5cqh)]">
        <h2 className={`${text.label} leading-tight font-semibold tracking-wide text-slate-400 uppercase`}>{panel.name}</h2>
        {panel.current ? (
          <div className="mt-[min(1vw,2cqh)] min-w-0">
            <p className={`${text.now} leading-tight font-medium text-sky-300`}>Now interviewing</p>
            <p className={`${text.name} ${text.clamp} leading-tight font-bold break-words`}>
              <span className="tabular-nums">#{panel.current.number}</span> <bdi>{panel.current.name}</bdi>
            </p>
            <Timer
              startedAt={panel.current.started_at}
              targetMinutes={targetMinutes}
              className={`${text.timer} block leading-tight font-semibold`}
              colorClassName="text-slate-200"
              overClassName="text-amber-300"
            />
          </div>
        ) : (
          <p className={`mt-[min(1vw,2cqh)] ${text.name} leading-tight font-bold text-emerald-400`}>Free</p>
        )}
        {panel.lined_up.length > 0 &&
          (size === 'compact' ? (
            <div className="mt-auto flex min-w-0 items-baseline gap-[0.6em] pt-[min(1vw,2cqh)] text-[length:min(1.9vw,7cqh)] leading-snug">
              <span className="shrink-0 text-[0.7em] text-slate-400">Up next</span>
              <ol className="flex min-w-0 gap-[1em]">
                {panel.lined_up.slice(0, 2).map((person) => (
                  <PersonRow key={person.number} person={person} />
                ))}
              </ol>
            </div>
          ) : (
            <div className="mt-auto min-h-0 pt-[min(1vw,2cqh)]">
              <p className="text-[length:min(1.3vw,4cqh)] leading-tight text-slate-400">Up next</p>
              <ol className="text-[length:min(1.9vw,5.5cqh)] leading-snug">
                {panel.lined_up.map((person) => (
                  <PersonRow key={person.number} person={person} />
                ))}
              </ol>
            </div>
          ))}
      </div>
    </section>
  );
}

function WaitingStrip({ people }: { people: DisplayPerson[] }) {
  return (
    <footer aria-label="Waiting" className="border-t border-slate-800 bg-slate-900/70 px-[3vw] py-[1.2vw]">
      <p className="text-[1.3vw] font-semibold tracking-wide text-slate-400 uppercase">Waiting</p>
      {people.length === 0 ? (
        <p className="text-[1.8vw] text-slate-500">Nobody waiting</p>
      ) : (
        <ol className="mt-[0.5vw] grid grid-cols-4 gap-x-[2vw] gap-y-[0.4vw] text-[1.8vw]">
          {people.map((person) => (
            <PersonRow key={person.number} person={person} />
          ))}
        </ol>
      )}
    </footer>
  );
}

function PersonRow({ person }: { person: DisplayPerson }) {
  return (
    <li className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
      <span className="text-slate-400 tabular-nums">#{person.number}</span> <bdi>{person.name}</bdi>
    </li>
  );
}

function InvalidLink() {
  return <div className="flex h-screen items-center justify-center bg-slate-950 text-[3vw] text-slate-300">Invalid display link</div>;
}

/** Ids of panels that just got a new candidate, each for FLASH_MS. */
function useFlash(panels: DisplayPanel[] | undefined): string[] {
  const previous = useRef<DisplayPanel[] | undefined>(undefined);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [flashing, setFlashing] = useState<string[]>([]);

  useEffect(() => {
    if (!panels) return;
    const fresh = newlySentIn(previous.current, panels);
    previous.current = panels;
    if (fresh.length === 0) return;
    setFlashing((ids) => [...new Set([...ids, ...fresh])]);
    timers.current.push(setTimeout(() => setFlashing((ids) => ids.filter((id) => !fresh.includes(id))), FLASH_MS));
  }, [panels]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return flashing;
}
