import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider } from '../components/ActionProvider.tsx';
import { ConnectionBanner } from '../components/ConnectionBanner.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { BoardPanel, BoardSnapshot, Criterion, MyEvaluationWithInterview, PanelInterview, Profile } from '../lib/types.ts';
import { useLiveSnapshot } from '../lib/useLiveSnapshot.ts';
import { EvaluatedCandidates } from './EvaluatedCandidates.tsx';
import { FindCandidate } from './FindCandidate.tsx';
import { InterviewWorkspace } from './InterviewWorkspace.tsx';
import { parseSection, SectionTabs, sectionPanelId, sectionTabId, YourNumbers, type Section } from './PanelistSections.tsx';
import { evaluatedList, myPanel, panelistStats, recentList, shownInterview } from './panelView.ts';
import { ReadyForNext } from './ReadyForNext.tsx';
import { RecentInterviews } from './RecentInterviews.tsx';
import { useStrandedMessages } from './useStrandedMessages.ts';

/** /panel: the panelist's screen (admins can open it too). */
export function PanelPage() {
  const api = useApi();
  const { state } = useAuth();
  const subscribe = useMemo(() => api.subscribeBoard(), [api]);
  const { data: board, error, status, reload } = useLiveSnapshot(api.boardSnapshot, subscribe);

  useEffect(() => {
    document.title = 'Panel · MLSA Induction';
  }, []);

  if (state.status !== 'signed_in') return null;
  if (!board) {
    return (
      <FullPageMessage title={error ? "Couldn't load the board" : 'Loading…'}>
        {error && (
          <>
            <p>{error}</p>
            <button type="button" className={`${buttonClasses('secondary', 'md')} mt-3`} onClick={reload}>
              Try again
            </button>
          </>
        )}
      </FullPageMessage>
    );
  }

  const panel = myPanel(board, state.profile.id);
  return (
    <ActionProvider onSettled={reload}>
      <ConnectionBanner status={status} />
      {/* Keyed by panel, so a switch never shows the old panel's interviews while the new ones load. */}
      {panel ? <InPanel key={panel.id} board={board} panel={panel} me={state.profile} /> : <PanelChooser board={board} />}
    </ActionProvider>
  );
}

function PanelChooser({ board }: { board: BoardSnapshot }) {
  const api = useApi();
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-xl font-semibold">Which panel are you sitting in?</h1>
      <p className="text-sm text-slate-600">You can switch any time from the top of the screen.</p>
      <div className="grid gap-2">
        {board.panels.map((panel) => (
          <ActionButton key={panel.id} size="md" action={() => api.setMyPanel(panel.id)}>
            {panel.name}
          </ActionButton>
        ))}
      </div>
    </main>
  );
}

function InPanel({ board, panel, me }: { board: BoardSnapshot; panel: BoardPanel; me: Profile }) {
  const api = useApi();
  const [recent, setRecent] = useState<PanelInterview[]>([]);
  const [evaluations, setEvaluations] = useState<MyEvaluationWithInterview[] | undefined>(undefined);
  const [criteria, setCriteria] = useState<Criterion[] | null>(null);
  const [formFailed, setFormFailed] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  // The chosen section is in the address, so a reload keeps it; Interview has none.
  const [params, setParams] = useSearchParams();
  const section = parseSection(params.get('view'));
  const choose = (next: Section) => setParams(next === 'interview' ? {} : { view: next });
  const boardVersion = board.server_time;
  const inductionId = board.induction.id;

  useEffect(() => {
    let current = true;
    api.panelInterviews(panel.id).then(
      (rows) => current && setRecent(rows),
      () => {}, // keep the last list; the board banner already shows connection trouble
    );
    return () => {
      current = false;
    };
  }, [api, panel.id, boardVersion]);

  // The form needs the criteria and this person's evaluations. Until both have loaded, try again on
  // every board reload (the board reloads after a reconnect) and on "Try again"; never guess either.
  const formReady = criteria !== null && evaluations !== undefined;
  const loadForm = useCallback(async () => {
    try {
      const [rows, mine] = await Promise.all([api.criteria(inductionId), api.myEvaluations(me.id, inductionId)]);
      setCriteria(rows);
      setEvaluations(mine);
      setFormFailed(false);
    } catch {
      setFormFailed(true);
    }
  }, [api, inductionId, me.id]);
  useEffect(() => {
    if (!formReady) void loadForm();
  }, [formReady, loadForm, boardVersion]);

  const reloadEvaluations = useCallback(() => {
    api.myEvaluations(me.id, inductionId).then(setEvaluations, () => {}); // keep the list we have
  }, [api, me.id, inductionId]);

  const shown = shownInterview(panel, recent, pinnedId, evaluations);
  const unsent = useStrandedMessages(me.id, shown?.id ?? null, boardVersion);
  const openRecent = (interviewId: string) => {
    setPinnedId(interviewId);
    choose('interview');
  };
  const openEvaluated = (interviewId: string) => {
    setPinnedId(interviewId);
    reloadEvaluations(); // an interview in another panel may have ended since the list loaded
    choose('interview');
  };
  const evaluated = evaluations ? new Set(evaluations.map((e) => e.interview_id)) : null;
  const stats = panelistStats(recent, evaluations);
  const next = panel.lane[0];
  const sectionProps = (id: Section) => ({ role: 'tabpanel', id: sectionPanelId(id), 'aria-labelledby': sectionTabId(id), hidden: section !== id });

  return (
    <main className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{panel.name}</h1>
        <PanelSwitch board={board} panel={panel} />
        <p className="text-sm text-slate-600">
          {next ? (
            <>
              Up next: <span className="tabular-nums">#{next.number}</span> <bdi>{next.name}</bdi>
            </>
          ) : (
            'Nobody lined up'
          )}
        </p>
        {pinnedId && (
          <button
            type="button"
            className={buttonClasses('secondary')}
            onClick={() => {
              setPinnedId(null);
              choose('interview');
            }}
          >
            Back to the current interview
          </button>
        )}
      </div>

      <ReadyForNext panel={panel} />

      <YourNumbers stats={stats} />

      {board.induction.results_published && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">Results are published; evaluations are locked.</p>
      )}

      <SectionTabs current={section} pending={stats?.pending ?? 0} evaluated={stats?.evaluated} onChoose={choose} />

      <div {...sectionProps('interview')}>
        {shown ? (
          <InterviewWorkspace
            key={shown.id}
            active={section === 'interview'}
            interview={shown}
            userId={me.id}
            criteria={criteria}
            evaluations={evaluations}
            formFailed={formFailed}
            onRetryForm={() => void loadForm()}
            locked={board.induction.results_published}
            targetMinutes={board.induction.target_interview_minutes}
            onEvaluationSubmitted={reloadEvaluations}
            boardVersion={boardVersion}
            canEnd={me.role === 'admin' || shown.inThisPanel}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">
            Nobody has been interviewed in {panel.name} yet. The candidate appears here as soon as they are sent in.
          </p>
        )}

      </div>

      <div {...sectionProps('recent')}>
        <RecentInterviews items={recentList(recent, shown?.id ?? null, evaluated)} unsent={unsent} onOpen={openRecent} />
      </div>

      <div {...sectionProps('evaluated')}>
        {evaluations ? (
          <EvaluatedCandidates items={evaluatedList(evaluations)} onOpen={openEvaluated} />
        ) : formFailed ? (
          <div role="alert" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <p>Couldn't load your evaluations. Check the connection.</p>
            <button type="button" className={`${buttonClasses('secondary')} mt-2`} onClick={() => void loadForm()}>
              Try again
            </button>
          </div>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading your evaluations…</p>
        )}
      </div>

      <div {...sectionProps('find')}>
        <div className="max-w-xl space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-600">Every candidate, in number order. Open anyone to read their application.</p>
          <FindCandidate board={board} />
        </div>
      </div>
    </main>
  );
}

/**
 * Switch panel and Leave panel, right next to the panel's name, so leaving is never hidden in a menu.
 * Leaving while this panel's interview is still on asks first.
 */
function PanelSwitch({ board, panel }: { board: BoardSnapshot; panel: BoardPanel }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const others = board.panels.filter((p) => p.id !== panel.id);
  const current = panel.current;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={box} className="relative flex gap-2">
      {others.length > 0 && (
        <button type="button" aria-expanded={open} className={buttonClasses('secondary', 'md')} onClick={() => setOpen((o) => !o)}>
          Switch panel
        </button>
      )}
      <ActionButton
        variant="danger"
        size="md"
        confirm={current ? `The interview with #${current.number} ${current.name} is still on. Leave ${panel.name} anyway?` : undefined}
        action={() => api.setMyPanel(null)}
      >
        Leave panel
      </ActionButton>
      {open && (
        <div role="group" aria-label="Switch to" className="absolute top-11 left-0 z-20 grid min-w-44 gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {others.map((p) => (
            <ActionButton key={p.id} variant="ghost" size="md" className="justify-start" action={() => api.setMyPanel(p.id)}>
              {p.name}
            </ActionButton>
          ))}
        </div>
      )}
    </div>
  );
}
