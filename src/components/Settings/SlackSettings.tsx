import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Save, AlertCircle, CheckCircle2, Eye, EyeOff,
  Send, Loader2, UserCheck, Trash2, RefreshCw, Copy, Check, Upload
} from 'lucide-react';

interface SlackConfig {
  id?: string;
  bot_token: string;
  default_channel_id: string;
  enabled: boolean;
}

interface SlackUserMapping {
  id: string;
  user_id: string;
  slack_user_id: string;
  profile?: {
    full_name: string;
    email: string;
  };
}

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
}

export default function SlackSettings() {
  const { profile } = useAuth();
  const [config, setConfig] = useState<SlackConfig>({
    bot_token: '',
    default_channel_id: '',
    enabled: false,
  });
  const [mappings, setMappings] = useState<SlackUserMapping[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newMappingUserId, setNewMappingUserId] = useState('');
  const [newMappingSlackId, setNewMappingSlackId] = useState('');
  const [editingMapping, setEditingMapping] = useState<string | null>(null);
  const [editSlackId, setEditSlackId] = useState('');
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/slack-invoice-bot`;

  function copyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      await Promise.all([loadConfig(), loadMappings(), loadUsers()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadConfig() {
    const { data } = await supabase
      .from('slack_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (data) {
      setConfig(data);
    }
  }

  async function loadMappings() {
    const { data } = await supabase
      .from('slack_user_mappings')
      .select('id, user_id, slack_user_id')
      .order('created_at', { ascending: true });

    if (data) {
      const enriched = await Promise.all(
        data.map(async (m) => {
          const { data: prof } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', m.user_id)
            .maybeSingle();
          return { ...m, profile: prof || undefined };
        })
      );
      setMappings(enriched);
    }
  }

  async function loadUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .order('full_name');

    if (data) {
      setUsers(data);
    }
  }

  async function saveConfig() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (config.id) {
        const { error: err } = await supabase
          .from('slack_config')
          .update({
            bot_token: config.bot_token,
            default_channel_id: config.default_channel_id,
            enabled: config.enabled,
            updated_at: new Date().toISOString(),
            updated_by: profile?.id,
          })
          .eq('id', config.id);

        if (err) throw err;
      } else {
        const { data, error: err } = await supabase
          .from('slack_config')
          .insert({
            bot_token: config.bot_token,
            default_channel_id: config.default_channel_id,
            enabled: config.enabled,
            updated_by: profile?.id,
          })
          .select()
          .maybeSingle();

        if (err) throw err;
        if (data) setConfig(data);
      }

      setSuccess('Konfiguracja Slack zapisana');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udalo sie zapisac konfiguracji');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!config.bot_token) {
      setError('Wprowadz Bot Token przed testem');
      return;
    }

    setTesting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/send-slack-notification/test-connection`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token || supabaseAnonKey}`,
          'Content-Type': 'application/json',
          'Apikey': supabaseAnonKey,
        },
        body: JSON.stringify({ bot_token: config.bot_token }),
      });

      const result = await response.json();

      if (result.ok) {
        setSuccess(`Polaczenie udane! Workspace: ${result.team || result.workspace_name || 'OK'}`);
      } else {
        const errMsg = result.error || result.message || `HTTP ${response.status}`;
        setError(`Blad Slack API: ${errMsg}`);
      }
    } catch (err) {
      setError('Nie udalo sie polaczyc ze Slack API');
    } finally {
      setTesting(false);
      setTimeout(() => {
        setSuccess(null);
        setError(null);
      }, 5000);
    }
  }

  async function addMapping() {
    if (!newMappingUserId || !newMappingSlackId.trim()) {
      setError('Wybierz uzytkownika i podaj Slack User ID');
      return;
    }

    setError(null);
    try {
      const { error: err } = await supabase
        .from('slack_user_mappings')
        .upsert({
          user_id: newMappingUserId,
          slack_user_id: newMappingSlackId.trim(),
        }, { onConflict: 'user_id' });

      if (err) throw err;

      setNewMappingUserId('');
      setNewMappingSlackId('');
      setSuccess('Przypisanie Slack dodane');
      loadMappings();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udalo sie dodac przypisania');
    }
  }

  async function updateMapping(mappingId: string) {
    if (!editSlackId.trim()) return;

    try {
      const { error: err } = await supabase
        .from('slack_user_mappings')
        .update({ slack_user_id: editSlackId.trim() })
        .eq('id', mappingId);

      if (err) throw err;

      setEditingMapping(null);
      setEditSlackId('');
      loadMappings();
      setSuccess('Przypisanie zaktualizowane');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udalo sie zaktualizowac');
    }
  }

  async function deleteMapping(mappingId: string) {
    try {
      const { error: err } = await supabase
        .from('slack_user_mappings')
        .delete()
        .eq('id', mappingId);

      if (err) throw err;

      loadMappings();
      setSuccess('Przypisanie usuniete');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udalo sie usunac');
    }
  }

  const unmappedUsers = users.filter(
    (u) => !mappings.some((m) => m.user_id === u.id)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 dark:text-red-300 text-xs">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-green-700 dark:text-green-300 text-xs">{success}</p>
        </div>
      )}

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2c-1.38 0-2.5 1.12-2.5 2.5V7h2.5C15.88 7 17 5.88 17 4.5S15.88 2 14.5 2z" />
                <path d="M7 9.5C7 8.12 8.12 7 9.5 7H12v2.5C12 10.88 10.88 12 9.5 12S7 10.88 7 9.5z" />
                <path d="M12 14.5c0-1.38-1.12-2.5-2.5-2.5S7 13.12 7 14.5 8.12 17 9.5 17H12v-2.5z" />
                <path d="M14.5 12c-1.38 0-2.5 1.12-2.5 2.5V17h2.5c1.38 0 2.5-1.12 2.5-2.5S15.88 12 14.5 12z" />
                <path d="M17 9.5C17 10.88 15.88 12 14.5 12H12V9.5C12 8.12 13.12 7 14.5 7S17 8.12 17 9.5z" />
                <path d="M9.5 2C8.12 2 7 3.12 7 4.5S8.12 7 9.5 7H12V4.5C12 3.12 10.88 2 9.5 2z" />
              </svg>
              <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">
                Konfiguracja Slack
              </h2>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-300 dark:bg-slate-600 peer-focus:ring-2 peer-focus:ring-brand-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-primary"></div>
              <span className="ml-2 text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">
                {config.enabled ? 'Aktywny' : 'Nieaktywny'}
              </span>
            </label>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
              Bot Token (xoxb-...)
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={config.bot_token}
                onChange={(e) => setConfig({ ...config, bot_token: e.target.value })}
                placeholder="xoxb-your-bot-token"
                className="w-full px-3 py-2 pr-10 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
              Token OAuth Twojego Slack Bota. Znajdziesz go w ustawieniach aplikacji Slack.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
              Domyslny kanal (ID)
            </label>
            <input
              type="text"
              value={config.default_channel_id}
              onChange={(e) => setConfig({ ...config, default_channel_id: e.target.value })}
              placeholder="C0123456789"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark text-sm font-mono"
            />
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
              ID kanalu Slack na ktory beda wysylane powiadomienia jesli uzytkownik nie ma przypisanego Slack ID.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary-hover transition-all disabled:opacity-50 text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Zapisz
            </button>
            <button
              onClick={testConnection}
              disabled={testing || !config.bot_token}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-300 dark:border-slate-600/50 text-text-primary-light dark:text-text-primary-dark font-medium rounded-lg hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-all disabled:opacity-50 text-sm"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Testuj polaczenie
            </button>
          </div>
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">
              Dodawanie faktur przez Slack
            </h2>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Użytkownicy mogą przesyłać faktury bezpośrednio przez wiadomość do bota Slack (PDF, JPG, PNG). Plik zostanie automatycznie dodany do systemu i przetworzony przez OCR.
          </p>

          <div>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
              URL Webhooka (Events API — Request URL)
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-lg text-xs font-mono text-text-primary-light dark:text-text-primary-dark overflow-x-auto whitespace-nowrap">
                {webhookUrl}
              </code>
              <button
                onClick={copyWebhookUrl}
                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 dark:border-slate-600/50 text-text-primary-light dark:text-text-primary-dark font-medium rounded-lg hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-all text-xs"
              >
                {copiedWebhook ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedWebhook ? 'Skopiowano' : 'Kopiuj'}
              </button>
            </div>
          </div>

          <div className="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg space-y-1.5">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Jak skonfigurować w Slack App?</p>
            <ol className="text-xs text-amber-700 dark:text-amber-400 space-y-1 list-decimal list-inside">
              <li>Wejdź na <strong>api.slack.com/apps</strong> i wybierz swoją aplikację</li>
              <li>Przejdź do <strong>Event Subscriptions</strong> i włącz eventy</li>
              <li>Wklej powyższy URL jako <strong>Request URL</strong></li>
              <li>W sekcji <strong>Subscribe to bot events</strong> dodaj: <code className="bg-amber-100 dark:bg-amber-900/30 px-1 rounded">message.im</code></li>
              <li>Zapisz zmiany i zrób <strong>reinstall</strong> aplikacji w workspace</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">
                Przypisania uzytkownikow do Slack
              </h2>
            </div>
            <button
              onClick={loadMappings}
              className="p-1.5 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-end gap-2 mb-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                Uzytkownik
              </label>
              <select
                value={newMappingUserId}
                onChange={(e) => setNewMappingUserId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
              >
                <option value="">Wybierz uzytkownika...</option>
                {unmappedUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                Slack Member ID
              </label>
              <input
                type="text"
                value={newMappingSlackId}
                onChange={(e) => setNewMappingSlackId(e.target.value)}
                placeholder="U0123456789"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark text-sm font-mono"
              />
            </div>
            <button
              onClick={addMapping}
              disabled={!newMappingUserId || !newMappingSlackId.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary-hover transition-all disabled:opacity-50 text-sm whitespace-nowrap"
            >
              <UserCheck className="w-4 h-4" />
              Dodaj
            </button>
          </div>

          {mappings.length > 0 ? (
            <div className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-light-surface-variant dark:bg-dark-surface-variant">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                      Uzytkownik
                    </th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                      Slack Member ID
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                      Akcje
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                  {mappings.map((m) => (
                    <tr key={m.id} className="hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors">
                      <td className="px-3 py-2">
                        <div className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                          {m.profile?.full_name || '-'}
                        </div>
                        <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                          {m.profile?.email || '-'}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {editingMapping === m.id ? (
                          <input
                            type="text"
                            value={editSlackId}
                            onChange={(e) => setEditSlackId(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                            autoFocus
                          />
                        ) : (
                          <code className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-text-primary-light dark:text-text-primary-dark">
                            {m.slack_user_id}
                          </code>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {editingMapping === m.id ? (
                            <>
                              <button
                                onClick={() => updateMapping(m.id)}
                                className="px-2 py-1 text-brand-primary text-xs font-medium hover:text-brand-primary/80 transition-colors"
                              >
                                Zapisz
                              </button>
                              <button
                                onClick={() => {
                                  setEditingMapping(null);
                                  setEditSlackId('');
                                }}
                                className="px-2 py-1 text-text-secondary-light dark:text-text-secondary-dark text-xs font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
                              >
                                Anuluj
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditingMapping(m.id);
                                  setEditSlackId(m.slack_user_id);
                                }}
                                className="px-2 py-1 text-brand-primary text-xs font-medium hover:text-brand-primary/80 transition-colors"
                              >
                                Edytuj
                              </button>
                              <button
                                onClick={() => deleteMapping(m.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-status-error text-xs font-medium hover:text-red-700 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-6 text-text-secondary-light dark:text-text-secondary-dark text-sm">
              Brak przypisan. Dodaj przypisanie uzytkownika do Slack Member ID powyzej.
            </div>
          )}

          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 rounded-lg">
            <p className="text-xs text-blue-800 dark:text-blue-300">
              <strong>Jak znalezc Slack Member ID?</strong> W Slacku kliknij na profil uzytkownika, potem "..." (Wiecej) i "Kopiuj ID uczestnika". Format: U0123456789.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
