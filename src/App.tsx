import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { SettingsProvider } from '@/state/SettingsContext';
import { NotificationsProvider } from '@/state/NotificationsContext';
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
import AnalysisHistory from '@/pages/AnalysisHistory';
import Backtesting from '@/pages/Backtesting';
import RiskCenter from '@/pages/RiskCenter';
import DataCenter from '@/pages/DataCenter';
import Notifications from '@/pages/Notifications';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/NotFound';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
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
      { path: 'analysis-history', element: <AnalysisHistory /> },
      { path: 'backtesting', element: <Backtesting /> },
      { path: 'risk', element: <RiskCenter /> },
      { path: 'data', element: <DataCenter /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return (
    <SettingsProvider>
      <NotificationsProvider>
        <RouterProvider router={router} />
      </NotificationsProvider>
    </SettingsProvider>
  );
}
