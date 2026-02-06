import React, { useState, useEffect } from 'react';
import { Save, Link as LinkIcon, Info, CheckCircle, XCircle, Loader, HardDrive, Mail, Plus, Trash2, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface DriveConfig {
  id: string;
  google_drive_folder_url: string;
  google_drive_folder_id: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EmailConfig {
  id: string;
  user_id: string;
  email_address: string;
  provider: string;
  imap_server: string;
  imap_port: number;
  email_username: string;
  email_password: string;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

const EMAIL_PROVIDERS = {
  gmail: { name: 'Gmail', server: 'imap.gmail.com', port: 993 },
  outlook: { name: 'Outlook', server: 'outlook.office365.com', port: 993 },
  wp: { name: 'WP', server: 'imap.wp.pl', port: 993 },
  onet: { name: 'Onet', server: 'imap.poczta.onet.pl', port: 993 },
  interia: { name: 'Interia', server: 'poczta.interia.pl', port: 993 },
  custom: { name: 'Własny IMAP', server: '', port: 993 },
};

export default function UserConfiguration() {
  const { user, profile } = useAuth();
  const [config, setConfig] = useState<DriveConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [emailConfigs, setEmailConfigs] = useState<EmailConfig[]>([]);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailForm, setEmailForm] = useState({
    email_address: '',
    provider: 'gmail',
    imap_server: 'imap.gmail.com',
    imap_port: 993,
    email_username: '',
    email_password: '',
  });
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadConfiguration();
    loadEmailConfigs();
  }, [user]);

  const loadConfiguration = async () => {
    try {
      const { data, error } = await supabase
        .from('user_drive_configs')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setConfig(data);
        setFolderUrl(data.google_drive_folder_url);
        setIsActive(data.is_active);
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
      setMessage({ type: 'error', text: 'Błąd podczas wczytywania konfiguracji' });
    } finally {
      setLoading(false);
    }
  };

  const loadEmailConfigs = async () => {
    try {
      const { data, error } = await supabase
        .from('user_email_configs')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      setEmailConfigs(data || []);
    } catch (error) {
      console.error('Error loading email configurations:', error);
    }
  };

  const handleProviderChange = (provider: string) => {
    const providerConfig = EMAIL_PROVIDERS[provider as keyof typeof EMAIL_PROVIDERS];
    setEmailForm({
      ...emailForm,
      provider,
      imap_server: providerConfig.server,
      imap_port: providerConfig.port,
    });
  };

  const handleAddEmail = async () => {
    if (!emailForm.email_address.trim() || !emailForm.email_username.trim() || !emailForm.email_password.trim()) {
      setEmailMessage({ type: 'error', text: 'Proszę wypełnić wszystkie pola' });
      return;
    }

    if (!emailForm.email_address.includes('@')) {
      setEmailMessage({ type: 'error', text: 'Nieprawidłowy adres email' });
      return;
    }

    if (emailForm.provider === 'custom' && !emailForm.imap_server.trim()) {
      setEmailMessage({ type: 'error', text: 'Proszę podać adres serwera IMAP' });
      return;
    }

    setEmailSaving(true);
    setEmailMessage(null);

    try {
      const { error } = await supabase
        .from('user_email_configs')
        .insert({
          user_id: user?.id,
          email_address: emailForm.email_address,
          provider: emailForm.provider,
          imap_server: emailForm.imap_server,
          imap_port: emailForm.imap_port,
          email_username: emailForm.email_username,
          email_password: emailForm.email_password,
          is_active: true,
        });

      if (error) throw error;

      setEmailMessage({ type: 'success', text: 'Skrzynka email została dodana pomyślnie' });
      setShowEmailForm(false);
      setEmailForm({
        email_address: '',
        provider: 'gmail',
        imap_server: 'imap.gmail.com',
        imap_port: 993,
        email_username: '',
        email_password: '',
      });
      await loadEmailConfigs();
    } catch (error: any) {
      console.error('Error adding email config:', error);
      setEmailMessage({ type: 'error', text: 'Błąd: ' + error.message });
    } finally {
      setEmailSaving(false);
    }
  };

  const handleToggleEmailActive = async (id: string, currentActive: boolean) => {
    try {
      const { error } = await supabase
        .from('user_email_configs')
        .update({ is_active: !currentActive })
        .eq('id', id);

      if (error) throw error;
      await loadEmailConfigs();
    } catch (error: any) {
      console.error('Error toggling email config:', error);
      setEmailMessage({ type: 'error', text: 'Błąd podczas aktualizacji: ' + error.message });
    }
  };

  const handleDeleteEmail = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę skrzynkę email?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('user_email_configs')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setEmailMessage({ type: 'success', text: 'Skrzynka email została usunięta' });
      await loadEmailConfigs();
    } catch (error: any) {
      console.error('Error deleting email config:', error);
      setEmailMessage({ type: 'error', text: 'Błąd podczas usuwania: ' + error.message });
    }
  };

  const handleSyncEmails = async () => {
    setSyncing(true);
    setEmailMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Brak sesji użytkownika');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-email-invoices`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Błąd podczas synchronizacji');
      }

      const result = await response.json();

      if (result.success) {
        setEmailMessage({
          type: 'success',
          text: `Zsynchronizowano ${result.synced} faktur(y)${result.errors ? '. Wystąpiły błędy dla niektórych kont.' : ''}`
        });
        await loadEmailConfigs();
      } else {
        throw new Error(result.error || 'Nieznany błąd');
      }
    } catch (error: any) {
      console.error('Error syncing emails:', error);
      setEmailMessage({ type: 'error', text: 'Błąd: ' + error.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    if (!folderUrl.trim()) {
      setMessage({ type: 'error', text: 'Proszę podać link do folderu Google Drive' });
      return;
    }

    if (!folderUrl.includes('drive.google.com/drive/folders/')) {
      setMessage({
        type: 'error',
        text: 'Nieprawidłowy format linku. Użyj linku w formacie: https://drive.google.com/drive/folders/ID_FOLDERU'
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      if (config) {
        const { error } = await supabase
          .from('user_drive_configs')
          .update({
            google_drive_folder_url: folderUrl,
            is_active: isActive,
          })
          .eq('id', config.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_drive_configs')
          .insert({
            user_id: user?.id,
            google_drive_folder_url: folderUrl,
            is_active: isActive,
          });

        if (error) throw error;
      }

      setMessage({ type: 'success', text: 'Konfiguracja została zapisana pomyślnie' });
      await loadConfiguration();
    } catch (error: any) {
      console.error('Error saving configuration:', error);
      setMessage({ type: 'error', text: 'Błąd podczas zapisywania konfiguracji: ' + error.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg p-4 overflow-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">
          Konfiguracja
        </h1>
        <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
          Skonfiguruj automatyczny import faktur z Google Drive i skrzynek email
        </p>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4 mb-4">
          <div className="flex items-start gap-2 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-800 dark:text-blue-300">
              <p className="font-semibold mb-1">Jak to działa?</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Podaj link do folderu na swoim Google Drive</li>
                <li>System będzie automatycznie pobierał nowe faktury z tego folderu</li>
                <li>Faktury zostaną przypisane do Twojego konta i działu</li>
                <li>Możesz włączać i wyłączać automatyczny import w dowolnym momencie</li>
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                Link do folderu Google Drive
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/ID_FOLDERU"
                  className="w-full px-3 py-2 pl-9 bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
                <LinkIcon className="absolute left-2.5 top-2.5 w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              </div>
              <p className="mt-1 text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                Skopiuj i wklej link do folderu z Twojego Google Drive
              </p>
            </div>

            {config?.google_drive_folder_id && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-start gap-2">
                  <HardDrive className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-green-800 dark:text-green-300">
                      Folder ID: {config.google_drive_folder_id}
                    </p>
                    {config.last_sync_at && (
                      <p className="text-[10px] text-green-700 dark:text-green-400 mt-0.5">
                        Ostatnia synchronizacja: {new Date(config.last_sync_at).toLocaleString('pl-PL')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg">
              <input
                type="checkbox"
                id="is-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 text-brand-primary bg-light-surface dark:bg-dark-surface border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
              />
              <label htmlFor="is-active" className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark cursor-pointer">
                Włącz automatyczny import faktur
              </label>
            </div>

            {message && (
              <div
                className={`p-3 rounded-lg border flex items-start gap-2 ${
                  message.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}
              >
                {message.type === 'success' ? (
                  <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                )}
                <p
                  className={`text-xs ${
                    message.type === 'success'
                      ? 'text-green-800 dark:text-green-300'
                      : 'text-red-800 dark:text-red-300'
                  }`}
                >
                  {message.text}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
              >
                {saving ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Zapisywanie...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Zapisz konfigurację
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
              Informacje o Twoim koncie
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg">
                <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                  Email:
                </span>
                <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
                  {profile?.email}
                </span>
              </div>
              {profile?.department_id && (
                <div className="flex justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg">
                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    Status:
                  </span>
                  <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
                    Przypisany do działu
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Skrzynki Email
            </h2>
            <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
              Automatyczny import faktur z załączników email
            </p>
          </div>
          <div className="flex items-center gap-2">
            {emailConfigs.length > 0 && (
              <button
                onClick={handleSyncEmails}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium text-xs disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Synchronizacja...' : 'Synchronizuj'}
              </button>
            )}
            <button
              onClick={() => setShowEmailForm(!showEmailForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-xs"
            >
              <Plus className="w-3 h-3" />
              Dodaj skrzynkę
            </button>
          </div>
        </div>

        {showEmailForm && (
          <div className="mb-4 p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-300 dark:border-slate-600">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                    Adres email
                  </label>
                  <input
                    type="email"
                    value={emailForm.email_address}
                    onChange={(e) => setEmailForm({ ...emailForm, email_address: e.target.value })}
                    placeholder="twoj@email.com"
                    className="w-full px-2 py-1.5 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-xs text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                    Provider
                  </label>
                  <select
                    value={emailForm.provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="w-full px-2 py-1.5 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-xs text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  >
                    {Object.entries(EMAIL_PROVIDERS).map(([key, value]) => (
                      <option key={key} value={key}>{value.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {emailForm.provider === 'custom' && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                      Serwer IMAP
                    </label>
                    <input
                      type="text"
                      value={emailForm.imap_server}
                      onChange={(e) => setEmailForm({ ...emailForm, imap_server: e.target.value })}
                      placeholder="imap.example.com"
                      className="w-full px-2 py-1.5 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-xs text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                      Port
                    </label>
                    <input
                      type="number"
                      value={emailForm.imap_port}
                      onChange={(e) => setEmailForm({ ...emailForm, imap_port: parseInt(e.target.value) })}
                      className="w-full px-2 py-1.5 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-xs text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                    Login/Username
                  </label>
                  <input
                    type="text"
                    value={emailForm.email_username}
                    onChange={(e) => setEmailForm({ ...emailForm, email_username: e.target.value })}
                    placeholder="login"
                    className="w-full px-2 py-1.5 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-xs text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                    Hasło
                  </label>
                  <input
                    type="password"
                    value={emailForm.email_password}
                    onChange={(e) => setEmailForm({ ...emailForm, email_password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-2 py-1.5 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-xs text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <Info className="w-3 h-3 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-blue-800 dark:text-blue-300">
                  Dla Gmail użyj <strong>hasła aplikacji</strong>, nie głównego hasła. Włącz weryfikację dwuetapową i wygeneruj hasło aplikacji w ustawieniach konta Google.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowEmailForm(false)}
                  className="px-3 py-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleAddEmail}
                  disabled={emailSaving}
                  className="flex items-center gap-1 px-3 py-1.5 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 font-medium text-xs"
                >
                  {emailSaving ? (
                    <>
                      <Loader className="w-3 h-3 animate-spin" />
                      Zapisywanie...
                    </>
                  ) : (
                    'Dodaj'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {emailMessage && (
          <div
            className={`mb-4 p-2 rounded-lg border flex items-start gap-2 ${
              emailMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}
          >
            {emailMessage.type === 'success' ? (
              <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-3 h-3 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            )}
            <p
              className={`text-[10px] ${
                emailMessage.type === 'success'
                  ? 'text-green-800 dark:text-green-300'
                  : 'text-red-800 dark:text-red-300'
              }`}
            >
              {emailMessage.text}
            </p>
          </div>
        )}

        {emailConfigs.length === 0 ? (
          <div className="text-center py-6 text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Nie masz jeszcze żadnych skonfigurowanych skrzynek email
          </div>
        ) : (
          <div className="space-y-2">
            {emailConfigs.map((emailConfig) => (
              <div
                key={emailConfig.id}
                className="p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-300 dark:border-slate-600"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2 flex-1">
                    <Mail className="w-4 h-4 text-brand-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                          {emailConfig.email_address}
                        </p>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                          emailConfig.is_active
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                        }`}>
                          {emailConfig.is_active ? 'Aktywna' : 'Nieaktywna'}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                        {EMAIL_PROVIDERS[emailConfig.provider as keyof typeof EMAIL_PROVIDERS]?.name || emailConfig.provider} • {emailConfig.imap_server}:{emailConfig.imap_port}
                      </p>
                      {emailConfig.last_sync_at && (
                        <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                          Ostatnia synchronizacja: {new Date(emailConfig.last_sync_at).toLocaleString('pl-PL')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => handleToggleEmailActive(emailConfig.id, emailConfig.is_active)}
                      className={`p-1.5 rounded transition-colors ${
                        emailConfig.is_active
                          ? 'text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
                          : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                      title={emailConfig.is_active ? 'Wyłącz' : 'Włącz'}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteEmail(emailConfig.id)}
                      className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                      title="Usuń"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-yellow-800 dark:text-yellow-300">
            <p className="font-semibold mb-1">Ważne!</p>
            <p>
              Upewnij się, że folder na Google Drive jest udostępniony systemowi.
              Faktury będą pobierane automatycznie w ustalonych interwałach czasowych.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
