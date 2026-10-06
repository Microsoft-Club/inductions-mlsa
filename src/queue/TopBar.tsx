import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { BoardSnapshot, CandidateStatus } from '../lib/types.ts';
import type { ListFilter } from './queueView.ts';
import { SearchBox } from './SearchBox.tsx';

const COUNTS: Array<[CandidateStatus, string]> = [
  ['registered', 'Registered'],
  ['waiting', 'Waiting'],
  ['interviewing', 'Interviewing'],
  ['interviewed', 'Interviewed'],
];

interface TopBarProps {
  board: BoardSnapshot;
  onImport: () => void;
  /** Opens the full list of candidates with that status. */
  onShowList: (filter: ListFilter) => void;
  /** Admins can open a candidate's full form from the search results. */
  canReadForms?: boolean;
  /** Only admins add panels. */
  canAddPanels?: boolean;
}

export function TopBar({ board, onImport, onShowList, canReadForms = false, canAddPanels = false }: TopBarProps) {
  const api = useApi();
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div role="group" aria-label="Candidate counts" className="flex flex-wrap gap-2 text-sm">
        {COUNTS.map(([status, label]) => (
          <button
            key={status}
            type="button"
            onClick={() => onShowList(status)}
            title={`Show every ${label.toLowerCase()} candidate`}
            className="rounded-md bg-slate-100 px-2.5 py-1 hover:bg-slate-200"
          >
            <span className="text-slate-600">{label}</span> <span className="font-semibold tabular-nums">{board.counts[status]}</span>
          </button>
        ))}
      </div>
      <SearchBox board={board} canReadForms={canReadForms} />
      <div className="ml-auto flex gap-2">
        <button type="button" className={buttonClasses('secondary', 'md')} onClick={onImport}>
          Import CSV
        </button>
        {canAddPanels && (
          <ActionButton variant="primary" size="md" action={() => api.addPanel()}>
            + Add panel
          </ActionButton>
        )}
      </div>
    </div>
  );
}
