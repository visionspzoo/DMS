import { useState, useEffect } from 'react';
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

export default function GoogleDriveConfig() {
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

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setConfig(data);
        setFolderUrl(data.google_drive_folder_url);
        setIsActive(data.is_active);
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
      setMessage({ type: 'error', text: 'Blad podczas wczytywania konfiguracji' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!folderUrl.trim()) {
      setMessage({ type: 'error', text: 'Prosze podac link do folderu Google Drive' });
      return;
    }

    if (!folderUrl.includes('drive.google.com/drive/folders/')) {
      setMessage({
        type: 'error',
        text: 'Nieprawidlowy format linku. Uzyj linku w formacie: https://drive.google.com/drive/folders/ID_FOLDERU',
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      if (config) {
        const { error } = await supabase
          .from('user_drive_configs')
          .update({ google_drive_folder_url: folderUrl, is_active: isActive })
          .eq('id', config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_drive_configs')
          .insert({ user_id: user?.id, google_drive_folder_url: folderUrl, is_active: isActive });
        if (error) throw error;
      }

      setMessage({ type: 'success', text: 'Konfiguracja zostala zapisana pomyslnie' });
      await loadConfiguration();
    } catch (error: any) {
      console.error('Error saving configuration:', error);
      setMessage({ type: 'error', text: 'Blad podczas zapisywania konfiguracji: ' + error.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader className="w-6 h-6 animate-spin text-brand-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-sky-600 flex items-center justify-center">
            <HardDrive className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Folder Google Drive
            </h2>
            <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
              Automatyczny import faktur PDF z wybranego folderu
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-800 dark:text-blue-300">
            <p className="font-semibold mb-1">Jak to dziala?</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Podaj link do folderu na swoim Google Drive</li>
              <li>System bedzie automatycznie pobieral nowe faktury z tego folderu</li>
              <li>Faktury zostana przypisane do Twojego konta i dzialu</li>
              <li>Wymaga polaczonego konta Google w zakladce "Gmail Workspace"</li>
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
              id="drive-is-active"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 text-brand-primary bg-light-surface dark:bg-dark-surface border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
            />
            <label htmlFor="drive-is-active" className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark cursor-pointer">
              Wlacz automatyczny import faktur
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
              <p className={`text-xs ${message.type === 'success' ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
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
                  Zapisz konfiguracje
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4">
        <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
          Informacje o Twoim koncie
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg">
            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Email:</span>
            <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
              {profile?.email}
            </span>
          </div>
          {profile?.department_id && (
            <div className="flex justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg">
              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Status:</span>
              <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
                Przypisany do dzialu
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
