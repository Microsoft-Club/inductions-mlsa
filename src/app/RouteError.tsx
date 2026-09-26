import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { buttonClasses } from '../components/ActionButton.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';

const PROJECTOR_RETRY_MS = 10_000;

/** Shown instead of React Router's error page when a screen crashes while rendering. */
export function RouteError() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/display')) return <ProjectorRecovery />;
  return (
    <FullPageMessage title="Something went wrong">
      <p>This screen hit an unexpected problem. Reloading usually fixes it.</p>
      <button type="button" className={`${buttonClasses('primary', 'md')} mt-3`} onClick={() => window.location.reload()}>
        Reload the page
      </button>
    </FullPageMessage>
  );
}

/** The projector never shows an error page (spec §11): it looks like it is connecting and reloads itself. */
function ProjectorRecovery() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), PROJECTOR_RETRY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div data-testid="projector-recovering" className="flex h-screen items-center justify-center bg-slate-950 text-[3vw] text-slate-500">
      Connecting…
    </div>
  );
}
