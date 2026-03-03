import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginForm } from './components/Auth/LoginForm';
import { AcceptInvitation } from './components/Auth/AcceptInvitation';
import { Dashboard } from './components/Dashboard/Dashboard';
import SettingsPanel from './components/Settings/SettingsPanel';
import { UploadInvoice } from './components/Dashboard/UploadInvoicePage';
import { InvoiceList } from './components/Dashboard/InvoiceListPage';
import AIAgent from './components/AIAgent/AIAgent';
import { ContractsPage } from './components/Contracts/ContractsPage';
import { ContractFullPage } from './components/Contracts/ContractFullPage';
import { KSEFInvoicesPage } from './components/KSEF/KSEFInvoicesPage';
import NotificationBell from './components/Dashboard/NotificationBell';
import UserConfiguration from './components/Configuration/UserConfiguration';
import { InstructionsPage } from './components/Instructions/InstructionsPage';
import { useState, useEffect } from 'react';
import { LayoutDashboard, FileText, Upload, Settings, LogOut, Moon, Sun, Menu, Bot, Ligature as FileSignature, Download, Cog, BookOpen, ShoppingCart } from 'lucide-react';

type AppView = 'dashboard' | 'invoices' | 'upload' | 'settings' | 'ai-agent' | 'contracts' | 'contract-detail' | 'ksef' | 'purchase-request' | 'configuration' | 'instructions';

function AppContent() {
  const { user, profile, loading, signOut } = useAuth();
  const [appView, setAppView] = useState<AppView>('dashboard');
  const [darkMode, setDarkMode] = useState(() => {
    if (profile?.theme_preference) {
      return profile.theme_preference === 'dark';
    }
    const saved = localStorage.getItem('aura-dark-mode');
    return saved === 'true';
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.theme_preference) {
      setDarkMode(profile.theme_preference === 'dark');
    }
  }, [profile?.theme_preference]);

  useEffect(() => {
    const saveThemePreference = async () => {
      if (!user) return;

      const { supabase } = await import('./lib/supabase');
      const newTheme = darkMode ? 'dark' : 'light';

      await supabase
        .from('profiles')
        .update({ theme_preference: newTheme })
        .eq('id', user.id);

      localStorage.setItem('aura-dark-mode', String(darkMode));
    };

    saveThemePreference();
  }, [darkMode, user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent"></div>
          <p className="mt-4 text-white text-lg">Ładowanie...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    // Check if user is on accept-invitation page
    if (window.location.pathname === '/accept-invitation') {
      return <AcceptInvitation />;
    }
    return <LoginForm />;
  }

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'invoices', label: 'Moje Faktury', icon: FileText },
    { id: 'ksef', label: 'Faktury KSEF', icon: Download },
    { id: 'purchase-request', label: 'Wniosek zakupowy', icon: ShoppingCart },
    { id: 'contracts', label: 'Moje Umowy', icon: FileSignature },
    { id: 'ai-agent', label: 'AuruśAI', icon: Bot },
    { id: 'configuration', label: 'Konfiguracja', icon: Cog },
    { id: 'instructions', label: 'Instrukcje', icon: BookOpen },
  ];

  if (profile.is_admin) {
    menuItems.push({ id: 'settings', label: 'Ustawienia', icon: Settings });
  }

  return (
    <div className={`h-screen ${darkMode ? 'dark' : ''}`}>
      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 h-screen ${sidebarOpen ? 'w-64' : 'w-16'} bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark border-r border-slate-200 dark:border-slate-700/50 transition-all duration-300 flex flex-col z-40`}>
        {/* Logo */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            <div className="bg-brand-primary p-1.5 rounded-lg">
              <FileText className="w-4 h-4 text-white" />
            </div>
            {sidebarOpen && (
              <div>
                <h1 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark">Aura DMS</h1>
              </div>
            )}
          </div>
        </div>

        {/* Menu Items */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = appView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setAppView(item.id as AppView)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${
                  isActive
                    ? 'bg-brand-primary text-white shadow-md'
                    : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant hover:text-text-primary-light dark:hover:text-text-primary-dark'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {sidebarOpen && <span className="font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Toggle Sidebar Button */}
        <div className="p-2 border-t border-slate-200 dark:border-slate-700/50">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full p-1.5 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant rounded-lg transition-colors flex items-center justify-center"
            title={sidebarOpen ? 'Zwiń menu' : 'Rozwiń menu'}
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={`h-screen flex flex-col ${sidebarOpen ? 'ml-64' : 'ml-16'} transition-all duration-300`}>
        {/* Top Bar */}
        <header className="bg-light-surface dark:bg-dark-surface border-b border-slate-200 dark:border-slate-700/50 px-4 py-2">
          <div className="flex items-center justify-end gap-2">
            <NotificationBell />
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-1.5 text-text-primary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant rounded-lg transition-colors"
              title={darkMode ? 'Tryb jasny' : 'Tryb ciemny'}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-3 py-1.5 text-text-primary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant rounded-lg transition-colors text-sm"
              title="Wyloguj"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-medium">Wyloguj</span>
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 bg-light-bg dark:bg-dark-bg overflow-auto">
          {appView === 'dashboard' && <Dashboard />}
          {appView === 'invoices' && <InvoiceList />}
          {appView === 'ksef' && <KSEFInvoicesPage />}
          {appView === 'purchase-request' && <PurchaseRequestPage />}
          {appView === 'contracts' && (
            <ContractsPage
              onOpenContract={(id: string) => {
                setSelectedContractId(id);
                setAppView('contract-detail');
              }}
            />
          )}
          {appView === 'contract-detail' && selectedContractId && (
            <ContractFullPage
              contractId={selectedContractId}
              onBack={() => {
                setSelectedContractId(null);
                setAppView('contracts');
              }}
            />
          )}
          {appView === 'ai-agent' && <AIAgent />}
          {appView === 'configuration' && <UserConfiguration />}
          {appView === 'settings' && profile.is_admin && <SettingsPanel />}
          {appView === 'instructions' && <InstructionsPage />}
        </main>
      </div>
    </div>
  );
}

function PurchaseRequestPage() {
  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg flex flex-col overflow-hidden">
      <div className="flex-shrink-0 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/50 px-4 py-2.5 flex items-center gap-2.5">
        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">!</span>
        </div>
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
          W budowie &mdash; brak pełnej funkcjonalności
        </p>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-brand-primary/10 flex items-center justify-center mx-auto mb-4">
            <ShoppingCart className="w-8 h-8 text-brand-primary" />
          </div>
          <h2 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark mb-2">
            Wniosek zakupowy
          </h2>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Ta funkcja jest aktualnie w budowie. Wkrótce będzie można składać wnioski zakupowe bezpośrednio w systemie.
          </p>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
