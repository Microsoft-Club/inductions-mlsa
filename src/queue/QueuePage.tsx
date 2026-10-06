import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { ActionProvider } from '../components/ActionProvider.tsx';
import { buttonClasses } from '../components/ActionButton.tsx';
import { ConnectionBanner } from '../components/ConnectionBanner.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { useLiveSnapshot } from '../lib/useLiveSnapshot.ts';
import { CandidateListDialog } from './CandidateListDialog.tsx';
import { FormWarnings } from './FormWarnings.tsx';
import { ImportDialog } from './ImportDialog.tsx';
import { PanelCard } from './PanelCard.tsx';
import { PhotoFlowProvider } from './PhotoFlow.tsx';
import { PoolList } from './PoolList.tsx';
import { canManagePanels, parseListFilter, type ListFilter } from './queueView.ts';
import { TopBar } from './TopBar.tsx';

/** /queue: the queue manager's one screen (admins can open it too). */
export function QueuePage() {
  const api = useApi();
  const { state } = useAuth();
  const subscribe = useMemo(() => api.subscribeBoard(), [api]);
  const { data: board, error, status, reload } = useLiveSnapshot(api.boardSnapshot, subscribe);
  const [importing, setImporting] = useState(false);
  const role = state.status === 'signed_in' ? state.profile.role : 'queue_manager';

  // The candidate list lives in the URL (/queue?list=registered), so it can be linked to and Back closes it.
  const [params, setParams] = useSearchParams();
  const listFilter = parseListFilter(params.get('list'));
  const setList = useCallback(
    (filter: ListFilter | null, replace: boolean) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (filter) next.set('list', filter);
          else next.delete('list');
          return next;
        },
        { replace },
      ),
    [setParams],
  );
  const openList = useCallback((filter: ListFilter) => setList(filter, listFilter !== null), [setList, listFilter]);
  const closeList = useCallback(() => setList(null, true), [setList]);

  useEffect(() => {
    document.title = 'Queue · MLSA Induction';
  }, []);

  if (!board) {
    return (
      <FullPageMessage title={error ? "Couldn't load the board" : 'Loading the board…'}>
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

  return (
    <ActionProvider onSettled={reload}>
      <PhotoFlowProvider>
        <ConnectionBanner status={status} />
        <TopBar
          board={board}
          onImport={() => setImporting(true)}
          onShowList={openList}
          canReadForms={role === 'admin'}
          canAddPanels={canManagePanels(role)}
        />
        {/* ?? []: a database without the form-sync migration yet has no form_warnings. */}
        <FormWarnings warnings={board.form_warnings ?? []} />
        {error && (
          <p role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-800">
            Couldn't refresh the board: {error}
          </p>
        )}
        <main className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="grid content-start gap-4 lg:grid-cols-2">
            {board.panels.map((panel) => (
              <PanelCard key={panel.id} panel={panel} targetMinutes={board.induction.target_interview_minutes} role={role} />
            ))}
          </div>
          <PoolList board={board} />
        </main>
        {importing && <ImportDialog onClose={() => setImporting(false)} />}
        {listFilter && (
          <CandidateListDialog board={board} filter={listFilter} onFilterChange={openList} onClose={closeList} canReadForms={role === 'admin'} />
        )}
      </PhotoFlowProvider>
    </ActionProvider>
  );
}
