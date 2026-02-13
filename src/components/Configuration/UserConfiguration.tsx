import { useState } from 'react';
import { Mail, Key, User, Zap } from 'lucide-react';
import GmailWorkspaceConfig from './GmailWorkspaceConfig';
import AliceIntegration from './AliceIntegration';
import AccountInfo from './AccountInfo';
import NipAutomationRules from './NipAutomationRules';

type ConfigTab = 'account' | 'google' | 'alice' | 'automations';

const tabs: { id: ConfigTab; label: string; icon: typeof Mail }[] = [
  { id: 'account', label: 'Informacje o koncie', icon: User },
  { id: 'google', label: 'Google Workspace', icon: Mail },
  { id: 'alice', label: 'Alice API', icon: Key },
  { id: 'automations', label: 'Automatyzacje', icon: Zap },
];

export default function UserConfiguration() {
  const [activeTab, setActiveTab] = useState<ConfigTab>('account');

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg p-4 overflow-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">
          Konfiguracja
        </h1>
        <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
          Skonfiguruj integracje z Google i Alice
        </p>
      </div>

      <div className="mb-4 flex items-center gap-1 bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                activeTab === tab.id
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'account' && <AccountInfo />}
      {activeTab === 'google' && <GmailWorkspaceConfig />}
      {activeTab === 'alice' && <AliceIntegration />}
      {activeTab === 'automations' && <NipAutomationRules />}
    </div>
  );
}
