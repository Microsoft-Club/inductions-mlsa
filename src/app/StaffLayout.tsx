import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { buttonClasses } from '../components/ActionButton.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import type { Role } from '../lib/types.ts';
import { clearPhotoCache } from '../photos/usePhoto.ts';
import { ROLE_LABELS } from './homePath.ts';

const NAV: Array<{ to: string; label: string; roles: Role[] }> = [
  { to: '/queue', label: 'Queue', roles: ['queue_manager', 'admin'] },
  { to: '/panel', label: 'Panel', roles: ['panelist', 'admin'] },
  { to: '/results', label: 'Results', roles: ['admin'] },
  { to: '/admin', label: 'Admin', roles: ['admin'] },
];

/** Every signed-in screen: requires a login, shows who is signed in, and links the screens this role can open. */
export function StaffLayout() {
  const { state, signOut } = useAuth();
  const location = useLocation();
  // After "Sign out" the next person to sign in on this laptop should land on their own screen.
  const [signedOutHere, setSignedOutHere] = useState(false);

  // Photos are cached in memory only; the next person to sign in on this browser starts without them.
  useEffect(() => {
    if (state.status === 'signed_out') clearPhotoCache();
  }, [state.status]);

  if (state.status === 'loading') return <FullPageMessage title="Loading…" />;
  if (state.status === 'signed_out') {
    const next = signedOutHere ? '' : `?next=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={`/login${next}`} replace />;
  }

  const { profile } = state;
  const links = NAV.filter((link) => link.roles.includes(profile.role));
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-4 border-b border-slate-200 bg-white px-4">
        <span className="font-semibold">MLSA Induction</span>
        {links.length > 1 && (
          <nav aria-label="Screens" className="flex gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-1 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-slate-600 sm:inline">
            {profile.display_name} · {ROLE_LABELS[profile.role]}
          </span>
          <button
            type="button"
            onClick={() => {
              setSignedOutHere(true);
              void signOut();
            }}
            className={buttonClasses('ghost')}
          >
            Sign out
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
