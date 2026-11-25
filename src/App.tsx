import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { SettingsProvider } from '@/state/SettingsContext';
import { NotificationsProvider } from '@/state/NotificationsContext';
import { AuthProvider } from '@/state/AuthContext';
import { ToastProvider } from '@/state/ToastContext';
import { CommandPaletteProvider } from '@/state/CommandPaletteContext';
import { WatchlistProvider } from '@/state/WatchlistContext';
import { RequireAuth } from '@/state/RequireAuth';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Scanner from '@/pages/Scanner';
import ChartTerminal from '@/pages/ChartTerminal';
import Intelligence from '@/pages/Intelligence';
import Reports from '@/pages/Reports';
import StrategyLab from '@/pages/StrategyLab';
import StrategyCentre from '@/pages/StrategyCentre';
import StrategyBuilder from '@/pages/StrategyBuilder';
import AutonomousAnalysis from '@/pages/AutonomousAnalysis';
import StrategyComparisonPage from '@/pages/StrategyComparisonPage';
import PersonalizedScannerPage from '@/pages/PersonalizedScannerPage';
import PaperTrading from '@/pages/PaperTrading';
import Backtesting from '@/pages/Backtesting';
import RiskCenter from '@/pages/RiskCenter';
import DataCenter from '@/pages/DataCenter';
import Notifications from '@/pages/Notifications';
import Settings from '@/pages/Settings';
import AdminConsole from '@/pages/AdminConsole';
import NotFound from '@/pages/NotFound';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'scanner', element: <Scanner /> },
      { path: 'charts', element: <ChartTerminal /> },
      { path: 'intelligence', element: <Intelligence /> },
      { path: 'reports', element: <Reports /> },
      { path: 'strategy-lab', element: <StrategyLab /> },
      { path: 'strategy-centre', element: <StrategyCentre /> },
      { path: 'strategy-builder', element: <StrategyBuilder /> },
      { path: 'autonomous-analysis', element: <AutonomousAnalysis /> },
      { path: 'strategy-comparison', element: <StrategyComparisonPage /> },
      { path: 'personalized-scanner', element: <PersonalizedScannerPage /> },
      { path: 'paper-trading', element: <PaperTrading /> },
      { path: 'backtesting', element: <Backtesting /> },
      { path: 'risk', element: <RiskCenter /> },
      { path: 'data', element: <DataCenter /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'settings', element: <Settings /> },
      { path: 'admin', element: <AdminConsole /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return (
    <SettingsProvider>
      <NotificationsProvider>
        <AuthProvider>
          <ToastProvider>
            <WatchlistProvider>
              <CommandPaletteProvider>
                <RouterProvider router={router} />
              </CommandPaletteProvider>
            </WatchlistProvider>
          </ToastProvider>
        </AuthProvider>
      </NotificationsProvider>
    </SettingsProvider>
  );
}
