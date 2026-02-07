import { useState, useEffect } from 'react';
import { Info, CheckCircle, XCircle, Loader, Mail, Plus, Trash2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

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

export default function GmailWorkspaceConfig() {
  const { user } = useAuth();
  const [emailConfigs, setEmailConfigs] = useState<EmailConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailMessage, setEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  useEffect(() => {
    loadEmailConfigs();
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader className="w-6 h-6 animate-spin text-brand-primary" />
      </div>
    );
  }

  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
            <Mail className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Skrzynki Email (Google Workspace)
            </h2>
            <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
              Automatyczny import faktur z zalacznikow email przez OAuth
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
              <li>Token jest rowniez uzywany do synchronizacji z Google Drive</li>
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
        <div className="text-center py-8">
          <Mail className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Nie masz jeszcze zadnych polaczonych kont Google Workspace
          </p>
          <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-1">
            Kliknij "Polacz z Google" aby rozpoczac
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
  );
}
