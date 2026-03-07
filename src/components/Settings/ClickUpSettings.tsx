import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Save, AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, ExternalLink, Copy, Check
} from 'lucide-react';

interface ClickUpConfig {
  id?: string;
  api_token: string;
  list_id: string;
  enabled: boolean;
}

export default function ClickUpSettings() {
  const { profile } = useAuth();
  const [config, setConfig] = useState<ClickUpConfig>({
    api_token: '',
    list_id: '',
    enabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clickup-webhook`;

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('clickup_config')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (data) {
        setConfig({
          id: data.id,
          api_token: data.api_token || '',
          list_id: data.list_id || '',
          enabled: data.enabled ?? false,
        });
      }
    } catch (err) {
      console.error('Error loading ClickUp config:', err);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!profile?.is_admin) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (config.id) {
        const { error: err } = await supabase
          .from('clickup_config')
          .update({
            api_token: config.api_token,
            list_id: config.list_id,
            enabled: config.enabled,
            updated_at: new Date().toISOString(),
            updated_by: profile.id,
          })
          .eq('id', config.id);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase
          .from('clickup_config')
          .insert({
            api_token: config.api_token,
            list_id: config.list_id,
            enabled: config.enabled,
            updated_by: profile.id,
          })
          .select()
          .maybeSingle();
        if (err) throw err;
        if (data) setConfig(prev => ({ ...prev, id: data.id }));
      }
      setSuccess('Konfiguracja zapisana pomyslnie');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Nie udalo sie zapisac konfiguracji');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!config.api_token) {
      setError('Wprowadz token API przed testowaniem polaczenia');
      return;
    }
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-clickup-task`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'test_connection' }),
        }
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Test polaczenia nieudany');
      setSuccess(`Polaczenie z ClickUp dziala poprawnie. Workspace: ${result.workspace || 'OK'}`);
      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Blad polaczenia z ClickUp');
    } finally {
      setTesting(false);
    }
  }

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
        </div>
      )}

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">Konfiguracja ClickUp</h3>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
              Zaakceptowane wnioski zakupowe beda automatycznie tworzyc zadania w ClickUp
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Wlaczona</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={e => setConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                disabled={!profile?.is_admin}
                className="sr-only"
              />
              <div
                onClick={() => profile?.is_admin && setConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`w-11 h-6 rounded-full transition-colors cursor-pointer ${
                  config.enabled ? 'bg-brand-primary' : 'bg-slate-300 dark:bg-slate-600'
                } ${!profile?.is_admin ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  config.enabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </div>
            </div>
          </label>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
              Personal API Token
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={config.api_token}
                  onChange={e => setConfig(prev => ({ ...prev, api_token: e.target.value }))}
                  disabled={!profile?.is_admin}
                  placeholder="pk_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 pr-9 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={testConnection}
                disabled={testing || !config.api_token}
                className="px-3 py-2 text-xs font-medium border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors text-text-primary-light dark:text-text-primary-dark whitespace-nowrap flex items-center gap-1.5"
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Testuj polaczenie
              </button>
            </div>
            <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark mt-1">
              Wygeneruj token w: ClickUp &rarr; Profil &rarr; Apps &rarr; API Token
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
              ID Listy ClickUp
            </label>
            <input
              type="text"
              value={config.list_id}
              onChange={e => setConfig(prev => ({ ...prev, list_id: e.target.value }))}
              disabled={!profile?.is_admin}
              placeholder="np. 901234567890"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark mt-1">
              Otworz liste w ClickUp &rarr; kliknij "..." &rarr; "Copy link" &rarr; ID jest w URL po "/v/li/"
            </p>
          </div>
        </div>

        {profile?.is_admin && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Zapisz konfiguracje
            </button>
          </div>
        )}
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-4">
        <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">
          Webhook URL (synchronizacja statusow)
        </h3>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-3">
          Dodaj ten URL jako Webhook w ClickUp, aby zmiany statusu na "Complete" automatycznie oznaczaly wniosek jako oplacony w aplikacji.
        </p>

        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-lg text-text-primary-light dark:text-text-primary-dark font-mono truncate border border-slate-200 dark:border-slate-700">
            {webhookUrl}
          </code>
          <button
            onClick={copyWebhook}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-text-primary-light dark:text-text-primary-dark"
          >
            {copiedWebhook ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedWebhook ? 'Skopiowano' : 'Kopiuj'}
          </button>
        </div>

        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-800 dark:text-blue-300 font-medium mb-1">Jak skonfigurowac Webhook w ClickUp:</p>
          <ol className="text-xs text-blue-700 dark:text-blue-400 space-y-0.5 list-decimal list-inside">
            <li>Przejdz do Settings &rarr; Integrations &rarr; Webhooks w ClickUp</li>
            <li>Kliknij "Create Webhook"</li>
            <li>Wklej powyzszy URL jako Endpoint URL</li>
            <li>Zaznacz zdarzenie: "Task status updated"</li>
            <li>Zapisz Webhook</li>
          </ol>
          <a
            href="https://clickup.com/api"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Dokumentacja ClickUp API
          </a>
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-4">
        <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-3">
          Jak dziala integracja
        </h3>
        <div className="space-y-2">
          {[
            { step: '1', text: 'Uzytkownik sklada wniosek zakupowy w aplikacji' },
            { step: '2', text: 'Kierownik / Dyrektor akceptuje wniosek' },
            { step: '3', text: 'Aplikacja automatycznie tworzy zadanie w ClickUp z wszystkimi danymi wniosku' },
            { step: '4', text: 'Gdy status zadania w ClickUp zostanie zmieniony na "Complete", wniosek w aplikacji zostaje oznaczony jako "Oplacony"' },
          ].map(({ step, text }) => (
            <div key={step} className="flex items-start gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {step}
              </div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
