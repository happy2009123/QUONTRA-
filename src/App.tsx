import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/state/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import { SettingsProvider } from '@/state/SettingsContext';
import { NotificationsProvider } from '@/state/NotificationsContext';
import { ToastProvider } from '@/state/ToastContext';
import { CommandPaletteProvider } from '@/state/CommandPaletteContext';
import { WatchlistProvider } from '@/state/WatchlistContext';
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

function App() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // If loading, wait; otherwise, allow access regardless of auth status
    // by not redirecting to login
  }, []);

  return (
    <SettingsProvider>
      <NotificationsProvider>
        <ToastProvider>
          <WatchlistProvider>
            <CommandPaletteProvider>
              <nav>
                <ul>
                  <li><a href="/">Dashboard</a></li>
                  <li><a href="/scanner">Scanner</a></li>
                  <li><a href="/charts">Charts</a></li>
                  <li><a href="/settings">Settings</a></li>
                  <li><a href="/admin">Admin</a></li>
                </ul>
              </nav>
              <AppShell />
            </CommandPaletteProvider>
          </WatchlistProvider>
        </ToastProvider>
      </NotificationsProvider>
    </SettingsProvider>
  );
}

export default App;