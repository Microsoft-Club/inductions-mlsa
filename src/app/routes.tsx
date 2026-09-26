import type { RouteObject } from 'react-router';
import { AdminPage } from '../admin/AdminPage.tsx';
import { DisplayPage } from '../display/DisplayPage.tsx';
import { PanelPage } from '../panel/PanelPage.tsx';
import { SelectedPage } from '../public/SelectedPage.tsx';
import { CandidateRecordPage } from '../results/CandidateRecordPage.tsx';
import { ResultsPage } from '../results/ResultsPage.tsx';
import { QueuePage } from '../queue/QueuePage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { HomeRedirect, NotFound } from './placeholders.tsx';
import { RequireRole } from './RequireRole.tsx';
import { RouteError } from './RouteError.tsx';
import { StaffLayout } from './StaffLayout.tsx';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/display', element: <DisplayPage />, errorElement: <RouteError /> },
  { path: '/selected', element: <SelectedPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <StaffLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'queue', element: <RequireRole roles={['queue_manager', 'admin']}><QueuePage /></RequireRole> },
      { path: 'panel', element: <RequireRole roles={['panelist', 'admin']}><PanelPage /></RequireRole> },
      { path: 'admin', element: <RequireRole roles={['admin']}><AdminPage /></RequireRole> },
      { path: 'results', element: <RequireRole roles={['admin']}><ResultsPage /></RequireRole> },
      { path: 'results/:candidateId', element: <RequireRole roles={['admin']}><CandidateRecordPage /></RequireRole> },
    ],
  },
  { path: '*', element: <NotFound />, errorElement: <RouteError /> },
];
