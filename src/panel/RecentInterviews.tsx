import type { PanelInterview } from '../lib/types.ts';

interface RecentInterviewsProps {
  items: Array<PanelInterview & { pending: boolean }>;
  /** Interviews holding a message of yours that hasn't reached the server yet. */
  unsent?: Set<string>;
  onOpen: (interviewId: string) => void;
}

/**
 * The panel's earlier interviews; "Evaluation pending" until this panelist submits one, and
 * "Message not sent" while a message they wrote there is still waiting for the connection.
 */
export function RecentInterviews({ items, unsent, onOpen }: RecentInterviewsProps) {
  return (
    <section aria-labelledby="recent-title" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 id="recent-title" className="border-b border-slate-100 px-4 py-3 font-semibold">
        Recent
      </h2>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">No earlier interviews on this panel yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onOpen(item.id)}>
                <span className="tabular-nums">#{item.candidate.number}</span> <bdi>{item.candidate.full_name}</bdi>
              </button>
              {item.status === 'in_progress' && <span className="text-xs text-sky-700">in progress</span>}
              {item.pending && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Evaluation pending</span>
              )}
              {unsent?.has(item.id) && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-800">Message not sent</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
