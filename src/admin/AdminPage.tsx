import { useEffect } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { buttonClasses } from '../components/ActionButton.tsx';
import { AccountsSection } from './AccountsSection.tsx';
import { PanelsSection } from './PanelsSection.tsx';
import { PhotosSection } from './PhotosSection.tsx';
import { ProjectorLinkSection, SettingsSection } from './SettingsSection.tsx';

const LISTS: Array<[string, string]> = [
  ['registered', 'Registered'],
  ['waiting', 'Waiting'],
  ['interviewing', 'Interviewing'],
  ['interviewed', 'Interviewed'],
  ['all', 'Everyone'],
];

/** /admin: accounts, panels, settings, the projector link and shortcuts to candidates and results. */
export function AdminPage() {
  const { state } = useAuth();

  useEffect(() => {
    document.title = 'Admin · MLSA Induction';
  }, []);

  if (state.status !== 'signed_in') return null;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Link className={buttonClasses('primary', 'md')} to="/results">
          Results
        </Link>
      </div>
      <section aria-labelledby="admin-candidates-title" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="admin-candidates-title" className="font-semibold">Candidates</h2>
        <p className="text-sm text-slate-600">See everyone who registered, and where each person is on the day.</p>
        <div className="flex flex-wrap gap-2">
          {LISTS.map(([filter, label]) => (
            <Link key={filter} className={buttonClasses('secondary')} to={`/queue?list=${filter}`}>
              {label}
            </Link>
          ))}
        </div>
      </section>
      <AccountsSection me={state.profile} />
      <PanelsSection />
      <SettingsSection />
      <PhotosSection />
      <ProjectorLinkSection />
    </main>
  );
}
