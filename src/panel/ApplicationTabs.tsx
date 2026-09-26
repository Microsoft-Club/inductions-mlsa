import { useState } from 'react';
import type { Candidate } from '../lib/types.ts';
import { visibleSections } from './applicationView.ts';

/** General · Dev · LogiKal · L&D · Marketing · Contact, hiding sections and questions left blank. */
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
      <div role="tabpanel" id="application-panel" aria-labelledby={`application-tab-${active}`} className="max-h-[60vh] overflow-y-auto p-4">
        <dl className="space-y-4">
          {(section ? section.answers.map((a) => [a.q, a.a] as [string, string]) : contact.filter(([, v]) => v.trim() !== '')).map(([q, a], i) => (
            <div key={`${active}-${i}`}>
              <dt className="text-sm font-medium text-slate-600">{q}</dt>
              <dd dir="auto" className="mt-1 whitespace-pre-wrap">
                {a}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
