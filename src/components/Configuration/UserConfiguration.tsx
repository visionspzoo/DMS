import React, { useState, useEffect } from 'react';
import { Save, Link as LinkIcon, Info, CheckCircle, XCircle, Loader, HardDrive } from 'lucide-react';
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

export default function UserConfiguration() {
  const { user, profile } = useAuth();
  const [config, setConfig] = useState<DriveConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConfiguration();
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
    <div className="h-full bg-light-bg dark:bg-dark-bg p-6 overflow-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">
            Konfiguracja
          </h1>
          <p className="text-text-secondary-light dark:text-text-secondary-dark mt-2">
            Skonfiguruj automatyczny import faktur z Google Drive
          </p>
        </div>

        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-6">
          <div className="flex items-start gap-3 mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <p className="font-semibold mb-2">Jak to działa?</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Podaj link do folderu na swoim Google Drive</li>
                <li>System będzie automatycznie pobierał nowe faktury z tego folderu</li>
                <li>Faktury zostaną przypisane do Twojego konta i działu</li>
                <li>Możesz włączać i wyłączać automatyczny import w dowolnym momencie</li>
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                Link do folderu Google Drive
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/ID_FOLDERU"
                  className="w-full px-4 py-3 pl-10 bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-300 dark:border-slate-600 rounded-lg text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
                <LinkIcon className="absolute left-3 top-3.5 w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
              </div>
              <p className="mt-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Skopiuj i wklej link do folderu z Twojego Google Drive
              </p>
            </div>

            {config?.google_drive_folder_id && (
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-start gap-3">
                  <HardDrive className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                      Folder ID: {config.google_drive_folder_id}
                    </p>
                    {config.last_sync_at && (
                      <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                        Ostatnia synchronizacja: {new Date(config.last_sync_at).toLocaleString('pl-PL')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 p-4 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg">
              <input
                type="checkbox"
                id="is-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-5 h-5 text-brand-primary bg-light-surface dark:bg-dark-surface border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
              />
              <label htmlFor="is-active" className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark cursor-pointer">
                Włącz automatyczny import faktur
              </label>
            </div>

            {message && (
              <div
                className={`p-4 rounded-lg border flex items-start gap-3 ${
                  message.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}
              >
                {message.type === 'success' ? (
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                )}
                <p
                  className={`text-sm ${
                    message.type === 'success'
                      ? 'text-green-800 dark:text-green-300'
                      : 'text-red-800 dark:text-red-300'
                  }`}
                >
                  {message.text}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-3 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {saving ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Zapisywanie...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Zapisz konfigurację
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark mb-4">
              Informacje o Twoim koncie
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg">
                <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                  Email:
                </span>
                <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                  {profile?.email}
                </span>
              </div>
              {profile?.department_id && (
                <div className="flex justify-between p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg">
                  <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                    Status:
                  </span>
                  <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                    Przypisany do działu
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-800 dark:text-yellow-300">
              <p className="font-semibold mb-1">Ważne!</p>
              <p>
                Upewnij się, że folder na Google Drive jest udostępniony systemowi.
                Faktury będą pobierane automatycznie w ustalonych interwałach czasowych.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
