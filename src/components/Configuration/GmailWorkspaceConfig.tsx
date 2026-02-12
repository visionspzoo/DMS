import { useState, useEffect } from 'react';
import { Save, Link as LinkIcon, Info, CheckCircle, XCircle, Loader, Mail, Plus, Trash2, RefreshCw, HardDrive, Edit2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { getAccessibleDepartments } from '../../lib/departmentUtils';

interface EmailConfig {
  id: string;
  user_id: string;
  email_address: string;
  provider: string;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_token_expiry: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DriveConfig {
  id: string;
  google_drive_folder_url: string;
  google_drive_folder_id: string | null;
  is_active: boolean;
  last_sync_at: string | null;
}

interface FolderMapping {
  id: string;
  user_id: string;
  folder_name: string;
  google_drive_folder_url: string;
  google_drive_folder_id: string | null;
  department_id: string;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
  department?: {
    name: string;
  };
}

interface Department {
  id: string;
  name: string;
}

export default function GmailWorkspaceConfig() {
  const { user, profile } = useAuth();
  const [emailConfigs, setEmailConfigs] = useState<EmailConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailMessage, setEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  const [driveConfig, setDriveConfig] = useState<DriveConfig | null>(null);
  const [driveLoading, setDriveLoading] = useState(true);
  const [driveSaving, setDriveSaving] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');
  const [driveIsActive, setDriveIsActive] = useState(true);
  const [driveMessage, setDriveMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [driveSyncing, setDriveSyncing] = useState(false);

  const [folderMappings, setFolderMappings] = useState<FolderMapping[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showAddMappingForm, setShowAddMappingForm] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [mappingFormData, setMappingFormData] = useState({
    folder_name: '',
    google_drive_folder_url: '',
    department_id: '',
    is_active: true,
  });

  useEffect(() => {
    loadEmailConfigs();
    loadDriveConfig();
    loadFolderMappings();
    loadDepartments();
    handleOAuthCallback();
  }, [user]);

  const handleOAuthCallback = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (error) {
      setEmailMessage({ type: 'error', text: `Google OAuth error: ${error}` });
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (code) {
      setEmailMessage({ type: 'success', text: 'Przetwarzanie autoryzacji Google...' });

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Brak sesji uzytkownika');

        const redirectUri = `${window.location.origin}${window.location.pathname}`;
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-oauth-callback`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code, redirect_uri: redirectUri }),
          }
        );

        if (!response.ok) {
          let errorMsg = 'Blad podczas przetwarzania';
          try {
            const errorData = await response.json();
            errorMsg = errorData.error || errorMsg;
          } catch {
            errorMsg = `Serwer zwrocil blad ${response.status}`;
          }
          throw new Error(errorMsg);
        }

        const result = await response.json();
        if (result.success) {
          setEmailMessage({ type: 'success', text: `Polaczono z kontem: ${result.email}` });
          await loadEmailConfigs();
        } else {
          throw new Error(result.error || 'Nieznany blad');
        }
      } catch (error: any) {
        console.error('OAuth callback error:', error);
        setEmailMessage({ type: 'error', text: error.message || 'Wystapil blad podczas autoryzacji' });
      } finally {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  };

  const loadEmailConfigs = async () => {
    try {
      const { data, error } = await supabase
        .from('user_email_configs')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error && error.code !== 'PGRST116') throw error;
      setEmailConfigs(data || []);
    } catch (error) {
      console.error('Error loading email configurations:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDriveConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('user_drive_configs')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setDriveConfig(data);
        setFolderUrl(data.google_drive_folder_url);
        setDriveIsActive(data.is_active);
      }
    } catch (error) {
      console.error('Error loading drive configuration:', error);
    } finally {
      setDriveLoading(false);
    }
  };

  const loadFolderMappings = async () => {
    try {
      const { data, error } = await supabase
        .from('user_drive_folder_mappings')
        .select(`
          *,
          department:departments(name)
        `)
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFolderMappings(data || []);
    } catch (error) {
      console.error('Error loading folder mappings:', error);
    }
  };

  const loadDepartments = async () => {
    try {
      if (!profile) return;
      const accessibleDepts = await getAccessibleDepartments(profile);
      setDepartments(accessibleDepts);
    } catch (error) {
      console.error('Error loading departments:', error);
    }
  };

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    setEmailMessage(null);

    try {
      const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      const REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;

      const scopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/drive.readonly',
      ].join(' ');

      const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&access_type=offline` +
        `&prompt=consent`;

      window.location.href = authUrl;
    } catch (error: any) {
      console.error('Error connecting to Google:', error);
      setEmailMessage({ type: 'error', text: 'Blad podczas laczenia z Google: ' + error.message });
      setConnectingGoogle(false);
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
      setEmailMessage({ type: 'error', text: 'Blad podczas aktualizacji: ' + error.message });
    }
  };

  const handleDeleteEmail = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunac te skrzynke email?')) return;

    try {
      const { error } = await supabase
        .from('user_email_configs')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setEmailMessage({ type: 'success', text: 'Skrzynka email zostala usunieta' });
      await loadEmailConfigs();
    } catch (error: any) {
      console.error('Error deleting email config:', error);
      setEmailMessage({ type: 'error', text: 'Blad podczas usuwania: ' + error.message });
    }
  };

  const handleSyncEmails = async () => {
    setSyncing(true);
    setEmailMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji uzytkownika');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-email-invoices`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        const msg = result?.error || result?.message || `Serwer zwrocil blad ${response.status}`;
        throw new Error(msg);
      }

      if (result?.success === false) {
        throw new Error(result.error || result.errors?.join(', ') || 'Nieznany blad');
      }

      const errorsText = result?.errors?.length ? `. Bledy: ${result.errors.join('; ')}` : '';
      setEmailMessage({
        type: result?.errors?.length ? 'error' : 'success',
        text: `Zsynchronizowano ${result?.synced || 0} faktur(y)${errorsText}`,
      });
      await loadEmailConfigs();
    } catch (error: any) {
      console.error('Error syncing emails:', error);
      setEmailMessage({ type: 'error', text: 'Blad: ' + error.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncDrive = async () => {
    setDriveSyncing(true);
    setDriveMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji uzytkownika');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-drive-invoices`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Blad ${response.status}`);
      }

      const result = await response.json();
      console.log('Drive sync result:', result);

      if (result.warnings && result.warnings.length > 0) {
        setDriveMessage({
          type: 'warning',
          text: `Zsynchronizowano ${result.total_synced || 0} faktur(y). OSTRZEŻENIA: ${result.warnings.join('; ')}`,
        });
      } else {
        const errorsText = result?.errors?.length ? `. Bledy: ${result.errors.join('; ')}` : '';
        setDriveMessage({
          type: result?.errors?.length ? 'error' : 'success',
          text: `Zsynchronizowano ${result?.total_synced || 0} faktur(y) z Google Drive${errorsText}`,
        });
      }
      await loadDriveConfig();
      await loadFolderMappings();
    } catch (error: any) {
      console.error('Error syncing Drive:', error);
      setDriveMessage({ type: 'error', text: 'Blad: ' + error.message });
    } finally {
      setDriveSyncing(false);
    }
  };

  const handleSaveDrive = async () => {
    if (!folderUrl.trim()) {
      setDriveMessage({ type: 'error', text: 'Prosze podac link do folderu Google Drive' });
      return;
    }

    if (!folderUrl.includes('drive.google.com/drive/folders/')) {
      setDriveMessage({
        type: 'error',
        text: 'Nieprawidlowy format linku. Uzyj: https://drive.google.com/drive/folders/ID_FOLDERU',
      });
      return;
    }

    setDriveSaving(true);
    setDriveMessage(null);

    try {
      if (driveConfig) {
        const { error } = await supabase
          .from('user_drive_configs')
          .update({ google_drive_folder_url: folderUrl, is_active: driveIsActive })
          .eq('id', driveConfig.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_drive_configs')
          .insert({ user_id: user?.id, google_drive_folder_url: folderUrl, is_active: driveIsActive });
        if (error) throw error;
      }

      setDriveMessage({ type: 'success', text: 'Konfiguracja folderu zapisana pomyslnie' });
      await loadDriveConfig();
    } catch (error: any) {
      console.error('Error saving drive config:', error);
      setDriveMessage({ type: 'error', text: 'Blad: ' + error.message });
    } finally {
      setDriveSaving(false);
    }
  };

  const resetMappingForm = () => {
    setMappingFormData({
      folder_name: '',
      google_drive_folder_url: '',
      department_id: '',
      is_active: true,
    });
    setShowAddMappingForm(false);
    setEditingMappingId(null);
  };

  const validateMappingForm = () => {
    if (!mappingFormData.folder_name.trim()) {
      setDriveMessage({ type: 'error', text: 'Prosze podac nazwe folderu' });
      return false;
    }

    if (!mappingFormData.google_drive_folder_url.trim()) {
      setDriveMessage({ type: 'error', text: 'Prosze podac link do folderu' });
      return false;
    }

    if (!mappingFormData.google_drive_folder_url.includes('drive.google.com/drive/folders/')) {
      setDriveMessage({
        type: 'error',
        text: 'Nieprawidlowy format linku. Uzyj: https://drive.google.com/drive/folders/ID_FOLDERU',
      });
      return false;
    }

    if (!mappingFormData.department_id) {
      setDriveMessage({ type: 'error', text: 'Prosze wybrac dzial' });
      return false;
    }

    return true;
  };

  const handleSaveMapping = async () => {
    if (!validateMappingForm()) return;

    setDriveSaving(true);
    setDriveMessage(null);

    try {
      if (editingMappingId) {
        const { error } = await supabase
          .from('user_drive_folder_mappings')
          .update({
            folder_name: mappingFormData.folder_name,
            google_drive_folder_url: mappingFormData.google_drive_folder_url,
            department_id: mappingFormData.department_id,
            is_active: mappingFormData.is_active,
          })
          .eq('id', editingMappingId);

        if (error) throw error;
        setDriveMessage({ type: 'success', text: 'Mapowanie folderu zaktualizowane' });
      } else {
        const { error } = await supabase
          .from('user_drive_folder_mappings')
          .insert({
            user_id: user?.id,
            folder_name: mappingFormData.folder_name,
            google_drive_folder_url: mappingFormData.google_drive_folder_url,
            department_id: mappingFormData.department_id,
            is_active: mappingFormData.is_active,
          });

        if (error) throw error;
        setDriveMessage({ type: 'success', text: 'Mapowanie folderu dodane' });
      }

      await loadFolderMappings();
      resetMappingForm();
    } catch (error: any) {
      console.error('Error saving folder mapping:', error);
      setDriveMessage({ type: 'error', text: 'Blad: ' + error.message });
    } finally {
      setDriveSaving(false);
    }
  };

  const handleEditMapping = (mapping: FolderMapping) => {
    setMappingFormData({
      folder_name: mapping.folder_name,
      google_drive_folder_url: mapping.google_drive_folder_url,
      department_id: mapping.department_id,
      is_active: mapping.is_active,
    });
    setEditingMappingId(mapping.id);
    setShowAddMappingForm(true);
    setDriveMessage(null);
  };

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunac to mapowanie folderu?')) return;

    try {
      const { error } = await supabase
        .from('user_drive_folder_mappings')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setDriveMessage({ type: 'success', text: 'Mapowanie folderu usuniete' });
      await loadFolderMappings();
    } catch (error: any) {
      console.error('Error deleting folder mapping:', error);
      setDriveMessage({ type: 'error', text: 'Blad podczas usuwania: ' + error.message });
    }
  };

  const handleToggleMappingActive = async (id: string, currentActive: boolean) => {
    try {
      const { error } = await supabase
        .from('user_drive_folder_mappings')
        .update({ is_active: !currentActive })
        .eq('id', id);

      if (error) throw error;
      await loadFolderMappings();
    } catch (error: any) {
      console.error('Error toggling folder mapping:', error);
      setDriveMessage({ type: 'error', text: 'Blad podczas aktualizacji: ' + error.message });
    }
  };

  if (loading || driveLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader className="w-6 h-6 animate-spin text-brand-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Mail className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                Konto Google Workspace
              </h2>
              <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                Polacz konto Google aby korzystac z Gmail i Drive
              </p>
            </div>
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
              onClick={handleConnectGoogle}
              disabled={connectingGoogle}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-xs disabled:opacity-50"
            >
              {connectingGoogle ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Laczenie...
                </>
              ) : (
                <>
                  <Plus className="w-3 h-3" />
                  Polacz z Google
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-800 dark:text-blue-300">
              <p className="font-semibold mb-1">Jak to dziala?</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Polacz swoje konto Google Workspace przez OAuth</li>
                <li>System automatycznie pobiera zalaczniki PDF z wiadomosci email</li>
                <li>OCR weryfikuje czy zalacznik to faktura przed importem</li>
                <li>Ten sam token jest uzywany do synchronizacji z Google Drive (ponizej)</li>
              </ul>
            </div>
          </div>
        </div>

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
          <div className="text-center py-6">
            <Mail className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Nie masz jeszcze zadnych polaczonych kont Google
            </p>
            <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-1">
              Kliknij "Polacz z Google" aby uzyskac dostep do Gmail i Drive
            </p>
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
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                            emailConfig.is_active
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {emailConfig.is_active ? 'Aktywna' : 'Nieaktywna'}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                        Google Workspace -- OAuth (Gmail + Drive)
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
                      title={emailConfig.is_active ? 'Wylacz' : 'Wlacz'}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteEmail(emailConfig.id)}
                      className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                      title="Usun"
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

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-sky-600 flex items-center justify-center">
              <HardDrive className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                Foldery Google Drive
              </h2>
              <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                Automatyczny import faktur PDF - przypisz foldery do dzialow
              </p>
            </div>
          </div>
          {!showAddMappingForm && emailConfigs.length > 0 && (
            <button
              onClick={() => setShowAddMappingForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-xs"
            >
              <Plus className="w-3 h-3" />
              Dodaj folder
            </button>
          )}
        </div>

        {emailConfigs.length === 0 && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Najpierw polacz konto Google powyzej, aby system mogl pobierac pliki z Drive.
              </p>
            </div>
          </div>
        )}

        {emailConfigs.length > 0 && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-blue-800 dark:text-blue-300">
                <p className="font-semibold mb-1">Jak to dziala?</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Dodaj wiele folderow Google Drive</li>
                  <li>Kazdy folder przypisz do konkretnego dzialu</li>
                  <li>Faktury z danego folderu automatycznie trafia do wybranego dzialu</li>
                  <li>Mozesz miec dostep do wielu dzialow i konfigurowac rozne foldery dla kazdego</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {driveMessage && (
          <div
            className={`mb-4 p-2.5 rounded-lg border flex items-start gap-2 ${
              driveMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : driveMessage.type === 'warning'
                ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}
          >
            {driveMessage.type === 'success' ? (
              <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            ) : driveMessage.type === 'warning' ? (
              <Info className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            )}
            <p className={`text-xs ${
              driveMessage.type === 'success'
                ? 'text-green-800 dark:text-green-300'
                : driveMessage.type === 'warning'
                ? 'text-orange-800 dark:text-orange-300'
                : 'text-red-800 dark:text-red-300'
            }`}>
              {driveMessage.text}
            </p>
          </div>
        )}

        {showAddMappingForm && (
          <div className="mb-4 p-4 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-300 dark:border-slate-600">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                {editingMappingId ? 'Edytuj folder' : 'Dodaj nowy folder'}
              </h3>
              <button
                onClick={resetMappingForm}
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
              >
                <X className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                  Nazwa folderu
                </label>
                <input
                  type="text"
                  value={mappingFormData.folder_name}
                  onChange={(e) => setMappingFormData({ ...mappingFormData, folder_name: e.target.value })}
                  placeholder="np. Faktury Marketing"
                  className="w-full px-3 py-2 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                  Link do folderu Google Drive
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={mappingFormData.google_drive_folder_url}
                    onChange={(e) => setMappingFormData({ ...mappingFormData, google_drive_folder_url: e.target.value })}
                    placeholder="https://drive.google.com/drive/folders/ID_FOLDERU"
                    className="w-full px-3 py-2 pl-9 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />
                  <LinkIcon className="absolute left-2.5 top-2.5 w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                  Przypisz do dzialu
                </label>
                <select
                  value={mappingFormData.department_id}
                  onChange={(e) => setMappingFormData({ ...mappingFormData, department_id: e.target.value })}
                  className="w-full px-3 py-2 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                >
                  <option value="">Wybierz dzial</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
                {departments.length === 0 && (
                  <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                    Brak dostepnych dzialow. Skontaktuj sie z administratorem.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="mapping-is-active"
                  checked={mappingFormData.is_active}
                  onChange={(e) => setMappingFormData({ ...mappingFormData, is_active: e.target.checked })}
                  className="w-4 h-4 text-brand-primary bg-light-surface dark:bg-dark-surface border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
                />
                <label htmlFor="mapping-is-active" className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark cursor-pointer">
                  Wlacz automatyczny import z tego folderu
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={resetMappingForm}
                  className="px-4 py-2 text-text-primary-light dark:text-text-primary-dark hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium text-sm"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSaveMapping}
                  disabled={driveSaving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                >
                  {driveSaving ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      Zapisywanie...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      {editingMappingId ? 'Zaktualizuj' : 'Dodaj'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {folderMappings.length === 0 && !showAddMappingForm && emailConfigs.length > 0 && (
          <div className="text-center py-6">
            <HardDrive className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Nie masz jeszcze zadnych skonfigurowanych folderow
            </p>
            <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-1">
              Kliknij "Dodaj folder" aby skonfigurowac automatyczny import
            </p>
          </div>
        )}

        {folderMappings.length > 0 && (
          <div className="space-y-2 mb-4">
            {folderMappings.map((mapping) => (
              <div
                key={mapping.id}
                className="p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-300 dark:border-slate-600"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2 flex-1">
                    <HardDrive className="w-4 h-4 text-brand-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark">
                          {mapping.folder_name}
                        </p>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                            mapping.is_active
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {mapping.is_active ? 'Aktywne' : 'Nieaktywne'}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                        Dzial: <span className="font-medium">{mapping.department?.name || 'Brak'}</span>
                      </p>
                      <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5 truncate">
                        Folder ID: {mapping.google_drive_folder_id || 'Nie wyodrebniono'}
                      </p>
                      {mapping.last_sync_at && (
                        <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                          Ostatnia synchronizacja: {new Date(mapping.last_sync_at).toLocaleString('pl-PL')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => handleToggleMappingActive(mapping.id, mapping.is_active)}
                      className={`p-1.5 rounded transition-colors ${
                        mapping.is_active
                          ? 'text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
                          : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                      title={mapping.is_active ? 'Wylacz' : 'Wlacz'}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleEditMapping(mapping)}
                      className="p-1.5 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
                      title="Edytuj"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteMapping(mapping.id)}
                      className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                      title="Usun"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(folderMappings.length > 0 || driveConfig) && emailConfigs.length > 0 && (
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={handleSyncDrive}
              disabled={driveSyncing}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${driveSyncing ? 'animate-spin' : ''}`} />
              {driveSyncing ? 'Synchronizacja...' : 'Synchronizuj wszystkie foldery'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4">
        <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
          Informacje o koncie
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
