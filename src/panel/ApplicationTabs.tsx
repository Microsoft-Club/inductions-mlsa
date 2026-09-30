import { Fragment, useState } from 'react';
import type { Candidate } from '../lib/types.ts';
import { visibleSections } from './applicationView.ts';

/** General · Dev · LogiKal · L&D · Marketing · Brainees · Contact, hiding sections and questions left blank. */
export function ApplicationTabs({ candidate }: { candidate: Candidate }) {
  const sections = visibleSections(candidate);
  const tabs = [...sections.map((s) => ({ key: s.key as string, label: s.label })), { key: 'contact', label: 'Contact' }];
  const [chosen, setChosen] = useState(tabs[0].key);
  const active = tabs.some((t) => t.key === chosen) ? chosen : tabs[0].key;
  const section = sections.find((s) => s.key === active);
  const contact: Array<[string, string]> = [
    ['Email', candidate.email],
    ['Google account', candidate.account_email],
    ['Phone (WhatsApp)', candidate.phone],
    ['Registration number', candidate.reg_number],
    ['Department', candidate.department],
    ['Batch', candidate.batch],
  ];

  return (
    <section aria-label="Application" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div role="tablist" aria-label="Application sections" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-2 pt-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`application-tab-${tab.key}`}
            aria-selected={tab.key === active}
            aria-controls="application-panel"
            onClick={() => setChosen(tab.key)}
            className={`shrink-0 rounded-t-md px-3 py-2 text-sm font-medium ${
              tab.key === active ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="application-panel" aria-labelledby={`application-tab-${active}`} className="max-h-[60vh] overflow-y-auto p-3 sm:p-4">
        {section ? (
          // One box per question: the question on a tinted strip with its number, the answer below.
          <dl className="space-y-3">
            {section.answers.map((answer, i) => (
              <div key={`${active}-${i}`} className="overflow-hidden rounded-lg border border-slate-200">
                <dt className="flex items-baseline gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
                  <span className="shrink-0 rounded bg-white px-1.5 text-xs font-semibold tabular-nums">Q{i + 1}</span>
                  <span>{answer.q}</span>
                </dt>
                <dd dir="auto" className="px-3 py-2.5 whitespace-pre-wrap">
                  {answer.a}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          // Contact details are facts, not answers: a plain label / value list.
          <dl className="grid sm:grid-cols-[max-content_minmax(0,1fr)]">
            {contact
              .filter(([, value]) => value.trim() !== '')
              .map(([label, value]) => (
                <Fragment key={label}>
                  <dt className="pt-2 text-sm text-slate-500 sm:border-b sm:border-slate-100 sm:pb-2">{label}</dt>
                  <dd dir="auto" className="min-w-0 border-b border-slate-100 pb-2 break-words sm:pt-2 sm:pl-6">
                    {value}
                  </dd>
                </Fragment>
              ))}
          </dl>
        )}
      </div>
    </section>
  );
}
