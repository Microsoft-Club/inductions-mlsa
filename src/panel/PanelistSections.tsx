// The panelist's own top bar: their numbers, and the four sections of /panel. Panelist-only: the
// staff header's links (Queue, Results, Admin) stay limited by role.
import type { PanelistStats } from './panelView.ts';

export type Section = 'interview' | 'recent' | 'evaluated' | 'find';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'interview', label: 'Interview' },
  { id: 'recent', label: 'Recent' },
  { id: 'evaluated', label: 'Evaluated' },
  { id: 'find', label: 'Find a candidate' },
];

/** The section named in the address (`/panel?view=recent`); Interview when there is none. */
export function parseSection(value: string | null): Section {
  return SECTIONS.some((s) => s.id === value) ? (value as Section) : 'interview';
}

export const sectionTabId = (section: Section) => `panel-section-${section}-tab`;
export const sectionPanelId = (section: Section) => `panel-section-${section}`;

/** Interviewed · Evaluated · Pending. "—" while the evaluations are still unknown. */
export function YourNumbers({ stats }: { stats: PanelistStats | null }) {
  const items: Array<[string, number | undefined]> = [
    ['Interviewed', stats?.interviewed],
    ['Evaluated', stats?.evaluated],
    ['Pending', stats?.pending],
  ];
  return (
    <section aria-label="Your numbers">
      <dl className="flex flex-wrap gap-2">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${label === 'Pending' && value ? 'text-amber-700' : 'text-slate-900'}`}>
              {value ?? '—'}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface SectionTabsProps {
  current: Section;
  /** Interviews on this panel waiting for your evaluation (shown on Recent). */
  pending: number;
  /** How many you evaluated; undefined while unknown. */
  evaluated: number | undefined;
  onChoose: (section: Section) => void;
}

export function SectionTabs({ current, pending, evaluated, onChoose }: SectionTabsProps) {
  return (
    <div role="tablist" aria-label="Sections" className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:flex">
      {SECTIONS.map(({ id, label }) => {
        const selected = id === current;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={sectionTabId(id)}
            aria-selected={selected}
            aria-controls={sectionPanelId(id)}
            onClick={() => onChoose(id)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
              selected ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
            {id === 'recent' && pending > 0 && (
              <>
                {' '}
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">{pending} pending</span>
              </>
            )}
            {id === 'evaluated' && evaluated !== undefined && (
              <>
                {' '}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 tabular-nums">{evaluated}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
