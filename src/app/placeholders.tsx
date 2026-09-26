import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { homePath } from './homePath.ts';

export function HomeRedirect() {
  const { state } = useAuth();
  return state.status === 'signed_in' ? <Navigate to={homePath(state.profile.role)} replace /> : null;
}

export function NotFound() {
  return (
    <FullPageMessage title="Page not found">
      <Link className="font-medium text-brand-600 underline" to="/">
        Go home
      </Link>
    </FullPageMessage>
  );
}
