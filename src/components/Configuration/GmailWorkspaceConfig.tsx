import { useState, useEffect } from 'react';
import { Save, Link as LinkIcon, Info, CheckCircle, XCircle, Loader, Mail, Plus, Trash2, RefreshCw, HardDrive, Edit2, X, AlertCircle, Calendar, RotateCcw } from 'lucide-react';
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
  default_assignee_id: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
  department?: {
    name: string;
  };
  default_assignee?: {
    full_name: string;
    role: string;
  };
}

interface Department {
  id: string;
  name: string;
}

interface DepartmentUser {
  id: string;
  full_name: string;
  role: string;
}

export default function GmailWorkspaceConfig() {
  const { user, profile } = useAuth();
  const [emailConfigs, setEmailConfigs] = useState<EmailConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailMessage, setEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ status: string; current: number; total: number; filename?: string } | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagResults, setDiagResults] = useState<any>(null);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const [showReimportPanel, setShowReimportPanel] = useState(false);
  const [reimportDateFrom, setReimportDateFrom] = useState('');
  const [reimportDateTo, setReimportDateTo] = useState('');
  const [reimporting, setReimporting] = useState(false);
  const [reimportProgress, setReimportProgress] = useState<{ status: string; current: number; total: number; filename?: string } | null>(null);
  const [reimportMessage, setReimportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [driveConfig, setDriveConfig] = useState<DriveConfig | null>(null);
  const [driveLoading, setDriveLoading] = useState(true);
  const [driveSaving, setDriveSaving] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');
  const [driveIsActive, setDriveIsActive] = useState(true);
  const [driveMessage, setDriveMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [debuggingDrive, setDebuggingDrive] = useState(false);
  const [debugResults, setDebugResults] = useState<any>(null);

  const [folderMappings, setFolderMappings] = useState<FolderMapping[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentUsers, setDepartmentUsers] = useState<DepartmentUser[]>([]);
  const [showAddMappingForm, setShowAddMappingForm] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [mappingFormData, setMappingFormData] = useState({
    folder_name: '',
    google_drive_folder_url: '',
    department_id: '',
    default_assignee_id: '',
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
          department:departments(name),
          default_assignee:profiles!user_drive_folder_mappings_default_assignee_id_fkey(full_name, role)
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

  const loadDepartmentUsers = async (departmentId: string) => {
    if (!departmentId) {
      setDepartmentUsers([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('department_id', departmentId)
        .order('full_name');

      if (error) throw error;
      setDepartmentUsers(data || []);
    } catch (error) {
      console.error('Error loading department users:', error);
      setDepartmentUsers([]);
    }
  };

  useEffect(() => {
    if (mappingFormData.department_id) {
      loadDepartmentUsers(mappingFormData.department_id);
    } else {
      setDepartmentUsers([]);
    }
  }, [mappingFormData.department_id]);

  const handleCheckOAuthStatus = async () => {
    setCheckingStatus(true);
    setEmailMessage(null);

    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        throw new Error('Nie udalo sie odswiezyc sesji. Prosze sie wylogowac i zalogowac ponownie.');
      }

      const session = refreshData.session;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-oauth-status`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to check OAuth status');
      }

      console.log('OAuth Status:', result);

      if (result.activeGoogleConfigs === 0) {
        setEmailMessage({
          type: 'error',
          text: `Brak aktywnej konfiguracji Google. Znaleziono ${result.totalConfigs} konfiguracji w bazie, ale zaden nie jest aktywny lub nie ma prawidlowego providera.`
        });
      } else {
        const config = result.configs[0];
        setEmailMessage({
          type: 'success',
          text: `Konfiguracja OK: ${config.email_address} | Token: ${config.hasAccessToken ? '✓' : '✗'} | Refresh: ${config.hasRefreshToken ? '✓' : '✗'} | Wygasa: ${config.tokenExpiry ? new Date(config.tokenExpiry).toLocaleString() : 'brak'}`
        });
      }
    } catch (error: any) {
      console.error('Error checking OAuth status:', error);
      setEmailMessage({ type: 'error', text: 'Blad sprawdzania statusu: ' + error.message });
    } finally {
      setCheckingStatus(false);
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
        'https://www.googleapis.com/auth/drive',
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
    setSyncProgress({ status: 'Łączenie z serwerem...', current: 0, total: 0 });
    setEmailMessage(null);

    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        throw new Error('Nie udalo sie odswiezyc sesji. Prosze sie wylogowac i zalogowac ponownie.');
      }

      const finalSession = refreshData.session;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-email-invoices?stream=1`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${finalSession.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || `Serwer zwrocil blad ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'account_start') {
              setSyncProgress({ status: `Sprawdzanie: ${event.email}`, current: 0, total: 0 });
            } else if (event.type === 'messages_found') {
              setSyncProgress({ status: `Znaleziono ${event.new} nowych wiadomości`, current: 0, total: event.new });
            } else if (event.type === 'no_messages') {
              setSyncProgress({ status: 'Brak nowych wiadomości z załącznikami', current: 0, total: 0 });
            } else if (event.type === 'processing_message') {
              setSyncProgress({ status: 'Przetwarzanie wiadomości...', current: event.current, total: event.total });
            } else if (event.type === 'processing_attachment') {
              setSyncProgress(prev => ({ ...prev!, status: 'Pobieranie załącznika', filename: event.filename, current: event.current, total: event.total }));
            } else if (event.type === 'uploading') {
              setSyncProgress(prev => ({ ...prev!, status: 'Przesyłanie do magazynu', filename: event.filename }));
            } else if (event.type === 'invoice_created') {
              setSyncProgress(prev => ({ ...prev!, status: 'Faktura zapisana', filename: event.filename }));
            } else if (event.type === 'ocr_start') {
              setSyncProgress(prev => ({ ...prev!, status: 'Rozpoznawanie tekstu (OCR)', filename: event.filename }));
            } else if (event.type === 'ocr_done') {
              setSyncProgress(prev => ({ ...prev!, status: 'OCR zakończony', filename: event.filename }));
            } else if (event.type === 'attachment_skipped') {
              setSyncProgress(prev => ({ ...prev!, status: 'Pominięto duplikat', filename: event.filename }));
            } else if (event.type === 'done') {
              finalResult = event;
            }
          } catch {}
        }
      }

      if (finalResult) {
        const errorsText = finalResult.errors?.length ? `. Błędy: ${finalResult.errors.join('; ')}` : '';
        setEmailMessage({
          type: finalResult.errors?.length ? 'error' : 'success',
          text: `Zsynchronizowano ${finalResult.synced || 0} faktur(y)${errorsText}`,
        });
      }

      await loadEmailConfigs();
    } catch (error: any) {
      console.error('Error syncing emails:', error);
      setEmailMessage({ type: 'error', text: 'Blad: ' + error.message });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleDiagnoseEmails = async () => {
    setDiagnosing(true);
    setDiagResults(null);
    setEmailMessage(null);
    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) throw new Error('Nie udalo sie odswiezyc sesji');
      const finalSession = refreshData.session;
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-email-invoices?diag=1`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${finalSession.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      let result = null;
      const rawText = await response.text().catch(() => null);
      try {
        result = rawText ? JSON.parse(rawText) : null;
      } catch {
        result = { error: `Nieprawidlowa odpowiedz HTTP ${response.status}: ${rawText?.substring(0, 200)}` };
      }
      if (!result) result = { error: `Brak odpowiedzi (HTTP ${response.status})` };
      setDiagResults(result);
    } catch (error: any) {
      setDiagResults({ error: error.message });
    } finally {
      setDiagnosing(false);
    }
  };

  const handleDebugDrive = async () => {
    setDebuggingDrive(true);
    setDriveMessage(null);
    setDebugResults(null);

    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        throw new Error('Nie udalo sie odswiezyc sesji. Prosze sie wylogowac i zalogowac ponownie.');
      }

      const session = refreshData.session;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/debug-drive-folder`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            folderId: driveConfig?.google_drive_folder_id,
          }),
        }
      );

      console.log('📥 Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.log('📦 Error response body:', errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
          console.log('📦 Parsed error data:', errorData);
        } catch {
          errorData = { error: errorText };
        }

        // If we got available folders, show them
        if (errorData.availableFolders) {
          console.log('📂 Available folders:', errorData.availableFolders);
          setDebugResults(errorData);
          setDriveMessage({
            type: 'error',
            text: errorData.message || errorData.error,
          });
          return;
        }

        throw new Error(errorData.error || `Blad ${response.status}`);
      }

      const result = await response.json();
      console.log('📦 Debug result:', result);
      console.log('📦 Folder ID:', result.folderId);
      console.log('📦 Total files:', result.totalFiles);
      console.log('📦 PDF count:', result.pdfCount);
      setDebugResults(result);

      setDriveMessage({
        type: 'success',
        text: `Diagnostyka zakonczona: ${result.message}`,
      });
    } catch (error: any) {
      console.error('Error debugging Drive:', error);
      setDriveMessage({ type: 'error', text: 'Blad diagnostyki: ' + error.message });
    } finally {
      setDebuggingDrive(false);
    }
  };

  const handleSyncDrive = async () => {
    setDriveSyncing(true);
    setDriveMessage(null);

    try {
      console.log('🔍 Starting Drive sync...');

      // Wymuszamy odświeżenie sesji
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      console.log('📋 Session data:', {
        hasSession: !!session,
        hasError: !!sessionError,
        error: sessionError,
        userId: session?.user?.id,
        expiresAt: session?.expires_at,
        now: Math.floor(Date.now() / 1000),
      });

      if (sessionError) {
        console.error('❌ Session error:', sessionError);
        throw new Error(`Blad sesji: ${sessionError.message}`);
      }

      if (!session) {
        console.error('❌ No session found');
        throw new Error('Brak sesji uzytkownika. Prosze sie wylogowac i zalogowac ponownie.');
      }

      // ALWAYS refresh session before Drive sync to ensure valid token
      console.log('🔄 FORCE refreshing session before Drive sync...');
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        console.error('❌ Session refresh failed:', refreshError);
        throw new Error('Nie udalo sie odswiezyc sesji. Prosze sie wylogowac i zalogowac ponownie.');
      }

      const finalSession = refreshData.session;
      if (!finalSession) throw new Error('Brak sesji po odswiezeniu');

      console.log('✅ Token refreshed successfully');
      console.log('🔐 New token:', {
        tokenStart: finalSession.access_token.substring(0, 30),
        tokenLength: finalSession.access_token.length,
        expiresAt: new Date((finalSession.expires_at || 0) * 1000).toISOString(),
      });

      // Verify token is valid by checking current user
      console.log('🔍 Verifying token validity...');
      const { data: verifyData, error: verifyError } = await supabase.auth.getUser(finalSession.access_token);
      if (verifyError) {
        console.error('❌ Token verification failed:', verifyError);
        throw new Error('Token jest nieważny po odświeżeniu. Proszę wylogować się i zalogować ponownie.');
      }
      console.log('✅ Token verified, user ID:', verifyData.user?.id);

      console.log('🚀 Sending request to edge function...');
      console.log('📤 Request details:', {
        url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-drive-invoices`,
        method: 'POST',
        authHeader: `Bearer ${finalSession.access_token.substring(0, 30)}...`,
      });

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-drive-invoices`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${finalSession.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );

      console.log('📥 Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Drive sync error response:', errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
        throw new Error(errorData.error || `Blad ${response.status}: ${errorText.substring(0, 200)}`);
      }

      const result = await response.json();
      console.log('📊 Drive sync result:', JSON.stringify(result, null, 2));
      console.log('📊 Total synced:', result.total_synced);
      console.log('📊 Errors:', result.errors);
      console.log('📊 Warnings:', result.warnings);

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
      default_assignee_id: '',
      is_active: true,
    });
    setDepartmentUsers([]);
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
            default_assignee_id: mappingFormData.default_assignee_id || null,
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
            default_assignee_id: mappingFormData.default_assignee_id || null,
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

  const handleEditMapping = async (mapping: FolderMapping) => {
    setMappingFormData({
      folder_name: mapping.folder_name,
      google_drive_folder_url: mapping.google_drive_folder_url,
      department_id: mapping.department_id,
      default_assignee_id: mapping.default_assignee_id || '',
      is_active: mapping.is_active,
    });
    setEditingMappingId(mapping.id);
    setShowAddMappingForm(true);
    setDriveMessage(null);

    // Załaduj użytkowników działu dla edycji
    if (mapping.department_id) {
      await loadDepartmentUsers(mapping.department_id);
    }
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

  const handleReimportEmails = async () => {
    if (!reimportDateFrom) {
      setReimportMessage({ type: 'error', text: 'Prosze podac date poczatkowa' });
      return;
    }

    setReimporting(true);
    setReimportProgress({ status: 'Laczenie z serwerem...', current: 0, total: 0 });
    setReimportMessage(null);

    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        throw new Error('Nie udalo sie odswiezyc sesji. Prosze sie wylogowac i zalogowac ponownie.');
      }

      const finalSession = refreshData.session;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-email-invoices?stream=1`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${finalSession.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            force_reimport: true,
            date_from: reimportDateFrom,
            date_to: reimportDateTo || undefined,
          }),
        }
      );

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || `Serwer zwrocil blad ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'account_start') {
              setReimportProgress({ status: `Sprawdzanie: ${event.email}`, current: 0, total: 0 });
            } else if (event.type === 'messages_found') {
              setReimportProgress({ status: `Znaleziono ${event.total} wiadomosci w zakresie dat`, current: 0, total: event.total });
            } else if (event.type === 'no_messages') {
              setReimportProgress({ status: 'Brak wiadomosci z zalacznikami w podanym zakresie dat', current: 0, total: 0 });
            } else if (event.type === 'processing_message') {
              setReimportProgress({ status: 'Przetwarzanie wiadomosci...', current: event.current, total: event.total });
            } else if (event.type === 'processing_attachment') {
              setReimportProgress(prev => ({ ...prev!, status: 'Pobieranie zalacznika', filename: event.filename, current: event.current, total: event.total }));
            } else if (event.type === 'uploading') {
              setReimportProgress(prev => ({ ...prev!, status: 'Przesylanie do magazynu', filename: event.filename }));
            } else if (event.type === 'invoice_created') {
              setReimportProgress(prev => ({ ...prev!, status: 'Faktura zapisana', filename: event.filename }));
            } else if (event.type === 'ocr_start') {
              setReimportProgress(prev => ({ ...prev!, status: 'Rozpoznawanie tekstu (OCR)', filename: event.filename }));
            } else if (event.type === 'ocr_done') {
              setReimportProgress(prev => ({ ...prev!, status: 'OCR zakonczony', filename: event.filename }));
            } else if (event.type === 'attachment_skipped') {
              const reason = event.reason === 'duplicate' ? 'duplikat (juz w systemie)' : 'nie jest faktura';
              setReimportProgress(prev => ({ ...prev!, status: `Pominieto: ${reason}`, filename: event.filename }));
            } else if (event.type === 'done') {
              finalResult = event;
            }
          } catch {}
        }
      }

      if (finalResult) {
        const errorsText = finalResult.errors?.length ? `. Bledy: ${finalResult.errors.join('; ')}` : '';
        const warningsText = finalResult.warnings?.length ? `. Ostrzezenia: ${finalResult.warnings.join('; ')}` : '';
        setReimportMessage({
          type: finalResult.errors?.length ? 'error' : 'success',
          text: `Zaimportowano ${finalResult.synced || 0} faktur(y)${errorsText}${warningsText}`,
        });
      }

      await loadEmailConfigs();
    } catch (error: any) {
      console.error('Error reimporting emails:', error);
      setReimportMessage({ type: 'error', text: 'Blad: ' + error.message });
    } finally {
      setReimporting(false);
      setReimportProgress(null);
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
            <button
              onClick={handleCheckOAuthStatus}
              disabled={checkingStatus}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium text-xs disabled:opacity-50"
            >
              {checkingStatus ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Sprawdzanie...
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3" />
                  Sprawdz Status
                </>
              )}
            </button>
            {emailConfigs.length > 0 && (
              <>
                <button
                  onClick={handleSyncEmails}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium text-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Synchronizacja...' : 'Synchronizuj'}
                </button>
                <button
                  onClick={() => { setShowReimportPanel(!showReimportPanel); setReimportMessage(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors font-medium text-xs ${showReimportPanel ? 'bg-slate-600 hover:bg-slate-700' : 'bg-slate-500 hover:bg-slate-600'} text-white`}
                >
                  <RotateCcw className="w-3 h-3" />
                  Ponowny import
                </button>
                <button
                  onClick={handleDiagnoseEmails}
                  disabled={diagnosing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors font-medium text-xs disabled:opacity-50"
                >
                  <AlertCircle className={`w-3 h-3 ${diagnosing ? 'animate-pulse' : ''}`} />
                  {diagnosing ? 'Diagnostyka...' : 'Diagnoza'}
                </button>
              </>
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

        {syncProgress && (
          <div className="mb-4 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
            <div className="flex items-center gap-2 mb-2">
              <Loader className="w-3 h-3 text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" />
              <span className="text-xs font-medium text-blue-800 dark:text-blue-300">{syncProgress.status}</span>
            </div>
            {syncProgress.filename && (
              <p className="text-[10px] text-blue-600 dark:text-blue-400 truncate mb-2 pl-5">{syncProgress.filename}</p>
            )}
            {syncProgress.total > 0 && (
              <div className="pl-5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-blue-600 dark:text-blue-400">Wiadomość {syncProgress.current} z {syncProgress.total}</span>
                  <span className="text-[10px] text-blue-600 dark:text-blue-400">{Math.round((syncProgress.current / syncProgress.total) * 100)}%</span>
                </div>
                <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-1.5">
                  <div
                    className="bg-blue-600 dark:bg-blue-400 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
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

        {diagResults && (
          <div className="mb-4 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Wyniki diagnostyki</p>
              <button onClick={() => setDiagResults(null)} className="text-amber-600 hover:text-amber-800 dark:text-amber-400">
                <XCircle className="w-3 h-3" />
              </button>
            </div>
            <pre className="text-[9px] text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap break-all mb-2">
              {JSON.stringify(diagResults, null, 2)}
            </pre>
            {diagResults.error && (
              <p className="text-[10px] text-red-700 dark:text-red-400">{diagResults.error}</p>
            )}
            {diagResults.results?.map((r: any, i: number) => (
              <div key={i} className="mb-2">
                <p className="text-[10px] font-medium text-amber-900 dark:text-amber-200">{r.email}</p>
                {r.error && <p className="text-[10px] text-red-600 dark:text-red-400">Blad: {r.error}</p>}
                {r.steps?.map((s: any, j: number) => (
                  <div key={j} className="text-[10px] text-amber-700 dark:text-amber-300 ml-2 mt-0.5">
                    {s.step === 'token' && <span>Token OAuth: {s.ok ? 'OK' : 'BLAD'}</span>}
                    {s.step === 'gmail_list' && (
                      <span>Gmail API ({s.status}): znaleziono {s.messageCount} wiadomosci z PDF (szacunkow: {s.resultSizeEstimate})</span>
                    )}
                    {s.step === 'already_processed' && (
                      <span>Przetworzone juz: {s.alreadyProcessed}/{s.total}, nowe do pobrania: {s.new}</span>
                    )}
                    {s.step === 'sample_message' && (
                      <div>
                        <span>Przykladowa wiadomosc: &quot;{s.subject}&quot;</span>
                        <span className="ml-1">- PDF-y: {s.pdfAttachments?.length ?? 0}</span>
                        {s.pdfAttachments?.map((a: any, k: number) => (
                          <span key={k} className="ml-2 text-amber-600 dark:text-amber-400">[{a.filename}]</span>
                        ))}
                      </div>
                    )}
                    {s.step === 'attachment_fetch' && (
                      <span>Pobieranie zalacznika: {s.ok ? `OK (${s.sizeBytes} bajtow)` : `BLAD (HTTP ${s.status})`}</span>
                    )}
                    {s.step === 'hash' && (
                      <span>Hash SHA-256: {s.hash}</span>
                    )}
                    {s.step === 'storage_upload' && (
                      <span>Upload do storage: {s.ok ? 'OK' : `BLAD: ${s.error}`}</span>
                    )}
                    {s.step === 'invoice_insert' && (
                      <span>Test zapisu faktury: {s.ok ? `OK (ID: ${s.id})` : `BLAD: ${s.error} [${s.code}]`}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {showReimportPanel && emailConfigs.length > 0 && (
          <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-300 dark:border-slate-600">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                  Ponowny import faktur z emaila
                </h3>
              </div>
              <button
                onClick={() => setShowReimportPanel(false)}
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
              >
                <X className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              </button>
            </div>

            <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-2">
                <Info className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-300">
                  <p className="font-semibold mb-1">Jak dziala ponowny import?</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Przeszukuje Gmail w podanym zakresie dat ignorujac historie pobranych wiadomosci</li>
                    <li>Faktury ktore juz sa w systemie (ten sam plik) zostana pominięte automatycznie</li>
                    <li>Przydatne gdy usunieto faktury z systemu i chcesz je ponownie zaimportowac</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                  Data od <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={reimportDateFrom}
                    onChange={(e) => setReimportDateFrom(e.target.value)}
                    className="w-full px-3 py-2 pl-8 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />
                  <Calendar className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                  Data do (opcjonalnie)
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={reimportDateTo}
                    onChange={(e) => setReimportDateTo(e.target.value)}
                    className="w-full px-3 py-2 pl-8 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />
                  <Calendar className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
                </div>
              </div>
            </div>

            {reimportProgress && (
              <div className="mb-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-2 mb-1">
                  <Loader className="w-3 h-3 text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" />
                  <span className="text-xs font-medium text-blue-800 dark:text-blue-300">{reimportProgress.status}</span>
                </div>
                {reimportProgress.filename && (
                  <p className="text-[10px] text-blue-600 dark:text-blue-400 truncate pl-5">{reimportProgress.filename}</p>
                )}
                {reimportProgress.total > 0 && (
                  <div className="pl-5 mt-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-blue-600 dark:text-blue-400">Wiadomosc {reimportProgress.current} z {reimportProgress.total}</span>
                      <span className="text-[10px] text-blue-600 dark:text-blue-400">{Math.round((reimportProgress.current / reimportProgress.total) * 100)}%</span>
                    </div>
                    <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-1.5">
                      <div
                        className="bg-blue-600 dark:bg-blue-400 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${Math.round((reimportProgress.current / reimportProgress.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {reimportMessage && (
              <div
                className={`mb-3 p-2 rounded-lg border flex items-start gap-2 ${
                  reimportMessage.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}
              >
                {reimportMessage.type === 'success' ? (
                  <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-3 h-3 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                )}
                <p className={`text-[10px] ${reimportMessage.type === 'success' ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                  {reimportMessage.text}
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleReimportEmails}
                disabled={reimporting || !reimportDateFrom}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
              >
                {reimporting ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Importowanie...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    Importuj z podanego okresu
                  </>
                )}
              </button>
            </div>
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
                  onChange={(e) => setMappingFormData({ ...mappingFormData, department_id: e.target.value, default_assignee_id: '' })}
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

              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                  Domyslny wlasciciel faktury (opcjonalnie)
                </label>
                <select
                  value={mappingFormData.default_assignee_id}
                  onChange={(e) => setMappingFormData({ ...mappingFormData, default_assignee_id: e.target.value })}
                  className="w-full px-3 py-2 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  disabled={!mappingFormData.department_id}
                >
                  <option value="">Automatycznie (Kierownik → Dyrektor)</option>
                  {departmentUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name} ({user.role})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  Wybierz uzytkownika, do ktorego faktury z tego folderu beda przypisane. Jesli nie wybierzesz, faktury beda przypisane do kierownika lub dyrektora dzialu.
                </p>
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
                      <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                        Wlasciciel: <span className="font-medium">
                          {mapping.default_assignee
                            ? `${mapping.default_assignee.full_name} (${mapping.default_assignee.role})`
                            : 'Automatycznie (Kierownik → Dyrektor)'}
                        </span>
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

        {emailConfigs.length > 0 && (
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={handleDebugDrive}
              disabled={debuggingDrive}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
            >
              <AlertCircle className={`w-4 h-4 ${debuggingDrive ? 'animate-spin' : ''}`} />
              {debuggingDrive ? 'Sprawdzanie...' : 'Diagnostyka folderu'}
            </button>
            {(folderMappings.length > 0 || driveConfig) && (
              <button
                onClick={handleSyncDrive}
                disabled={driveSyncing}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
              >
                <RefreshCw className={`w-4 h-4 ${driveSyncing ? 'animate-spin' : ''}`} />
                {driveSyncing ? 'Synchronizacja...' : 'Synchronizuj wszystkie foldery'}
              </button>
            )}
          </div>
        )}

        {debugResults && (
          <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-300 dark:border-slate-600">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                Wyniki diagnostyki
              </h3>
              <button
                onClick={() => setDebugResults(null)}
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
              >
                <X className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {debugResults.availableFolders && debugResults.availableFolders.length > 0 && (
                <div>
                  <p className="font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                    Dostępne foldery na Google Drive ({debugResults.availableFolders.length}):
                  </p>
                  <div className="bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 max-h-96 overflow-y-auto">
                    <div className="divide-y divide-slate-200 dark:divide-slate-700">
                      {debugResults.availableFolders.map((folder: any, idx: number) => (
                        <div key={idx} className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-text-primary-light dark:text-text-primary-dark truncate">
                                {folder.name}
                              </p>
                              <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-1 font-mono break-all">
                                ID: {folder.id}
                              </p>
                              {folder.webViewLink && (
                                <a
                                  href={folder.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-brand-primary hover:underline mt-1 inline-block"
                                >
                                  Otwórz w Google Drive
                                </a>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(folder.id);
                                setDriveMessage({ type: 'success', text: `Skopiowano ID: ${folder.id}` });
                              }}
                              className="flex-shrink-0 px-2 py-1 bg-brand-primary hover:bg-blue-700 text-white rounded text-[10px] font-medium transition-colors"
                            >
                              Kopiuj ID
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                    <p className="text-[10px] text-blue-800 dark:text-blue-300">
                      💡 Skopiuj ID folderu który chcesz użyć i wklej go w polu "Link do folderu Google Drive" w formacie: https://drive.google.com/drive/folders/FOLDER_ID
                    </p>
                  </div>
                </div>
              )}

              {debugResults.folderId && (
                <div>
                  <p className="font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">
                    Informacje o folderze:
                  </p>
                  <div className="bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700 font-mono text-[10px]">
                    <p>ID: {debugResults.folderId}</p>
                    <p>Nazwa: {debugResults.folderMetadata?.name || 'Brak'}</p>
                    <p>Typ: {debugResults.folderMetadata?.mimeType || 'Brak'}</p>
                  </div>
                </div>
              )}

              <div>
                <p className="font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">
                  Statystyki:
                </p>
                <div className="bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700">
                  <p>Wszystkich plików: <span className="font-semibold text-brand-primary">{debugResults.totalFiles}</span></p>
                  <p>Plików PDF: <span className="font-semibold text-green-600 dark:text-green-400">{debugResults.pdfCount}</span></p>
                </div>
              </div>

              {debugResults.pdfCount === 0 && debugResults.totalFiles > 0 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-amber-800 dark:text-amber-300">
                      <p className="font-semibold mb-1">Problem: Brak plików PDF</p>
                      <p className="text-[10px]">
                        W folderze jest {debugResults.totalFiles} plik(ów), ale żaden nie jest PDF.
                        System synchronizuje tylko pliki PDF.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {debugResults.allFiles && debugResults.allFiles.length > 0 && (
                <div>
                  <p className="font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">
                    Wszystkie pliki w folderze:
                  </p>
                  <div className="bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700 max-h-48 overflow-y-auto">
                    <ul className="space-y-1 text-[10px]">
                      {debugResults.allFiles.map((file: any, idx: number) => (
                        <li key={idx} className="flex items-start gap-2 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0 ${
                            file.mimeType === 'application/pdf'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                          }`}>
                            {file.mimeType === 'application/pdf' ? 'PDF' : file.mimeType?.split('/')[1]?.toUpperCase() || 'INNE'}
                          </span>
                          <span className="flex-1 truncate text-text-primary-light dark:text-text-primary-dark">
                            {file.name}
                          </span>
                          {file.size && (
                            <span className="text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0">
                              {(parseInt(file.size) / 1024).toFixed(1)} KB
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {debugResults.pdfFiles && debugResults.pdfFiles.length > 0 && (
                <div>
                  <p className="font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">
                    Pliki PDF gotowe do synchronizacji:
                  </p>
                  <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded border border-green-200 dark:border-green-800">
                    <ul className="space-y-1 text-[10px]">
                      {debugResults.pdfFiles.map((file: any, idx: number) => (
                        <li key={idx} className="text-green-800 dark:text-green-300 truncate">
                          {idx + 1}. {file.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
