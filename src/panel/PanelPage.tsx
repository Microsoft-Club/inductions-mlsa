import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider, useRunAction } from '../components/ActionProvider.tsx';
import { ConnectionBanner } from '../components/ConnectionBanner.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { BoardPanel, BoardSnapshot, Criterion, MyEvaluation, PanelInterview, Profile } from '../lib/types.ts';
import { useLiveSnapshot } from '../lib/useLiveSnapshot.ts';
import { FindCandidate } from './FindCandidate.tsx';
import { InterviewWorkspace } from './InterviewWorkspace.tsx';
import { myPanel, recentList, shownInterview } from './panelView.ts';
import { RecentInterviews } from './RecentInterviews.tsx';

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
  const [evaluations, setEvaluations] = useState<MyEvaluation[] | undefined>(undefined);
  const [criteria, setCriteria] = useState<Criterion[] | null>(null);
  const [formFailed, setFormFailed] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
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
      const [rows, mine] = await Promise.all([api.criteria(inductionId), api.myEvaluations(me.id)]);
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
    api.myEvaluations(me.id).then(setEvaluations, () => {}); // keep the list we have
  }, [api, me.id]);

  const shown = shownInterview(panel, recent, pinnedId);
  const evaluated = evaluations ? new Set(evaluations.map((e) => e.interview_id)) : null;
  const next = panel.lane[0];

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
          <button type="button" className={buttonClasses('secondary')} onClick={() => setPinnedId(null)}>
            Back to the current interview
          </button>
        )}
        <div className="ml-auto w-full sm:w-auto">
          <FindCandidate board={board} />
        </div>
      </div>

      {board.induction.results_published && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">Results are published; evaluations are locked.</p>
      )}

      {shown ? (
        <InterviewWorkspace
          key={shown.id}
          interview={shown}
          userId={me.id}
          criteria={criteria}
          evaluations={evaluations}
          formFailed={formFailed}
          onRetryForm={() => void loadForm()}
          locked={board.induction.results_published}
          targetMinutes={board.induction.target_interview_minutes}
          onEvaluationSubmitted={reloadEvaluations}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">
          Nobody has been interviewed in {panel.name} yet. The candidate appears here as soon as they are sent in.
        </p>
      )}

      <RecentInterviews items={recentList(recent, shown?.id ?? null, evaluated)} onOpen={setPinnedId} />
    </main>
  );
}

function PanelSwitch({ board, panel }: { board: BoardSnapshot; panel: BoardPanel }) {
  const api = useApi();
  const run = useRunAction();
  const [pending, setPending] = useState(false);

  async function change(value: string) {
    setPending(true);
    await run(() => api.setMyPanel(value || null));
    setPending(false);
  }

  return (
    <select
      aria-label="Your panel"
      value={panel.id}
      disabled={pending}
      onChange={(e) => void change(e.target.value)}
      className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
    >
      {board.panels.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option value="">Not in a panel</option>
    </select>
  );
}
