import { ActionButton } from '../components/ActionButton.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { parseServerTime } from '../lib/clock.ts';
import type { FormWarning } from '../lib/types.ts';

const clock = (iso: string) => new Date(parseServerTime(iso)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * What the Google Form sync flagged (the same checks as the CSV import's "Needs a closer look"),
 * until someone dismisses it. Hidden when there is nothing to check.
 */
export function FormWarnings({ warnings }: { warnings: FormWarning[] }) {
  const api = useApi();
  if (warnings.length === 0) return null;
  return (
    <section aria-label="Google Form warnings" className="border-b border-amber-200 bg-amber-50 px-4 py-3">
      <h2 className="text-sm font-semibold text-amber-900">Google Form sync needs a closer look ({warnings.length})</h2>
      <ul className="mt-2 max-h-60 divide-y divide-amber-200/70 overflow-y-auto">
        {warnings.map((warning) => {
          const who = [warning.reg_number, warning.name].filter(Boolean).join(' ') || 'the form';
          return (
            <li key={warning.id} className="flex items-start gap-3 py-1.5 text-sm sm:items-center">
              {/* Phones: who and when on one line, the reason under it. Wider: all on one line. */}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="flex flex-wrap items-baseline gap-x-2 sm:shrink-0">
                  <time dateTime={warning.created_at} className="text-xs text-amber-800 tabular-nums">
                    {clock(warning.created_at)}
                  </time>
                  {warning.reg_number && <span className="font-medium tabular-nums">{warning.reg_number}</span>}
                  {warning.name && <bdi className="font-medium">{warning.name}</bdi>}
                </span>
                <span className="min-w-0 text-slate-700">{warning.reason}</span>
              </div>
              <ActionButton variant="ghost" label={`Dismiss the warning about ${who}`} action={() => api.dismissFormWarning(warning.id)}>
                Dismiss
              </ActionButton>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
