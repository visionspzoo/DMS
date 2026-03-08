import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Save, AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, ExternalLink,
  Copy, Check, RefreshCw, Plus, Trash2, ArrowRight, ToggleLeft, ToggleRight,
  GripVertical, Type, AlignLeft, ChevronDown,
} from 'lucide-react';

interface ClickUpConfig {
  id?: string;
  api_token: string;
  list_id: string;
  enabled: boolean;
  paid_status: string;
  cached_custom_fields?: ClickUpField[];
}

interface ClickUpField {
  id: string;
  name: string;
  type: string;
  type_config?: unknown;
}

interface FieldMapping {
  id?: string;
  clickup_field_id: string;
  clickup_field_name: string;
  clickup_field_type: string;
  app_field: string;
  app_field_label: string;
  enabled: boolean;
  sort_order: number;
}

interface StandardFieldMapping {
  id?: string;
  _idx?: number;
  field_target: 'name' | 'description' | 'priority';
  label: string;
  app_field: string;
  app_field_label: string;
  enabled: boolean;
  sort_order: number;
}

const APP_FIELDS = [
  { value: 'description', label: 'Opis / Nazwa produktu' },
  { value: 'gross_amount', label: 'Kwota brutto (PLN)' },
  { value: 'quantity', label: 'Ilosc (szt.)' },
  { value: 'delivery_location', label: 'Miejsce dostawy' },
  { value: 'priority', label: 'Priorytet' },
  { value: 'link', label: 'Link do produktu' },
  { value: 'submitter_name', label: 'Imie i nazwisko wnioskodawcy' },
  { value: 'submitter_email', label: 'Email wnioskodawcy' },
  { value: 'department_name', label: 'Dzial' },
  { value: 'proforma_filename', label: 'Nazwa pliku proformy' },
  { value: 'bez_mpk', label: 'Bez MPK (Tak/Nie)' },
  { value: 'created_at', label: 'Data zlozenia wniosku' },
  { value: 'id', label: 'ID wniosku' },
  { value: 'payment_method', label: 'Metoda platnosci' },
  { value: 'pz_number', label: 'Numer PZ' },
];

const STANDARD_CLICKUP_FIELDS = [
  { value: 'name' as const, label: 'Nazwa zadania (name)', icon: Type },
  { value: 'description' as const, label: 'Opis zadania (description)', icon: AlignLeft },
  { value: 'priority' as const, label: 'Priorytet (priority)', icon: ChevronDown },
];

function callEdgeFunction(body: object) {
  return fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-clickup-task`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    }
  );
}

export default function ClickUpSettings() {
  const { profile } = useAuth();
  const [config, setConfig] = useState<ClickUpConfig>({
    api_token: '',
    list_id: '',
    enabled: false,
    paid_status: '',
    cached_custom_fields: [],
  });
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [standardMappings, setStandardMappings] = useState<StandardFieldMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingFields, setFetchingFields] = useState(false);
  const [savingMappings, setSavingMappings] = useState(false);
  const [savingStandard, setSavingStandard] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'standard' | 'mappings'>('config');

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clickup-webhook`;

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [configRes, mappingsRes, standardRes] = await Promise.all([
        supabase.from('clickup_config').select('*').limit(1).maybeSingle(),
        supabase.from('clickup_field_mappings').select('*').order('sort_order'),
        supabase.from('clickup_standard_field_mappings').select('*').order('sort_order'),
      ]);

      if (configRes.data) {
        setConfig({
          id: configRes.data.id,
          api_token: configRes.data.api_token || '',
          list_id: configRes.data.list_id || '',
          enabled: configRes.data.enabled ?? false,
          paid_status: configRes.data.paid_status || '',
          cached_custom_fields: configRes.data.cached_custom_fields || [],
        });
      }

      if (mappingsRes.data) setMappings(mappingsRes.data);
      if (standardRes.data) setStandardMappings(standardRes.data);
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
            paid_status: config.paid_status,
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
            paid_status: config.paid_status,
            updated_by: profile.id,
          })
          .select()
          .maybeSingle();
        if (err) throw err;
        if (data) setConfig(prev => ({ ...prev, id: data.id }));
      }
      setSuccess('Konfiguracja zapisana pomyslnie');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: unknown) {
      setError((err as Error).message || 'Nie udalo sie zapisac konfiguracji');
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
      const response = await callEdgeFunction({ action: 'test_connection', api_token: config.api_token });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Test polaczenia nieudany');
      setSuccess(`Polaczenie z ClickUp dziala poprawnie. Workspace: ${result.workspace || 'OK'}`);
      setTimeout(() => setSuccess(null), 5000);
    } catch (err: unknown) {
      setError((err as Error).message || 'Blad polaczenia z ClickUp');
    } finally {
      setTesting(false);
    }
  }

  async function fetchListFields() {
    if (!config.api_token || !config.list_id) {
      setError('Wprowadz token API i ID listy przed pobraniem pol');
      return;
    }
    setFetchingFields(true);
    setError(null);
    try {
      const response = await callEdgeFunction({
        action: 'fetch_list_fields',
        api_token: config.api_token,
        list_id: config.list_id,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Blad pobierania pol');
      setConfig(prev => ({ ...prev, cached_custom_fields: result.fields || [] }));
      setSuccess(`Pobrano ${result.fields?.length || 0} pol custom z listy ClickUp`);
      setTimeout(() => setSuccess(null), 4000);
      setActiveTab('mappings');
    } catch (err: unknown) {
      setError((err as Error).message || 'Blad pobierania pol ClickUp');
    } finally {
      setFetchingFields(false);
    }
  }

  function addMapping(clickupField: ClickUpField) {
    const alreadyMapped = mappings.some(m => m.clickup_field_id === clickupField.id);
    if (alreadyMapped) return;
    setMappings(prev => [
      ...prev,
      {
        clickup_field_id: clickupField.id,
        clickup_field_name: clickupField.name,
        clickup_field_type: clickupField.type,
        app_field: '',
        app_field_label: '',
        enabled: true,
        sort_order: prev.length,
      },
    ]);
  }

  function updateMappingAppField(index: number, appField: string) {
    const label = APP_FIELDS.find(f => f.value === appField)?.label || appField;
    setMappings(prev => prev.map((m, i) =>
      i === index ? { ...m, app_field: appField, app_field_label: label } : m
    ));
  }

  function toggleMapping(index: number) {
    setMappings(prev => prev.map((m, i) =>
      i === index ? { ...m, enabled: !m.enabled } : m
    ));
  }

  function removeMapping(index: number) {
    setMappings(prev => prev.filter((_, i) => i !== index));
  }

  async function saveMappings() {
    if (!profile?.is_admin) return;
    setSavingMappings(true);
    setError(null);
    try {
      const { error: delErr } = await supabase
        .from('clickup_field_mappings')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw delErr;

      const toInsert = mappings
        .filter(m => m.app_field)
        .map((m, i) => ({
          clickup_field_id: m.clickup_field_id,
          clickup_field_name: m.clickup_field_name,
          clickup_field_type: m.clickup_field_type,
          app_field: m.app_field,
          app_field_label: m.app_field_label,
          enabled: m.enabled,
          sort_order: i,
        }));

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from('clickup_field_mappings')
          .insert(toInsert);
        if (insErr) throw insErr;
      }

      await loadAll();
      setSuccess('Mapowanie pol custom zapisane pomyslnie');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: unknown) {
      setError((err as Error).message || 'Nie udalo sie zapisac mapowania');
    } finally {
      setSavingMappings(false);
    }
  }

  function addStandardLine(target: StandardFieldMapping['field_target']) {
    setStandardMappings(prev => [
      ...prev,
      {
        field_target: target,
        label: '',
        app_field: '',
        app_field_label: '',
        enabled: true,
        sort_order: prev.filter(m => m.field_target === target).length,
      },
    ]);
  }

  function updateStandardMapping(index: number, changes: Partial<StandardFieldMapping>) {
    setStandardMappings(prev => prev.map((m, i) => {
      if (i !== index) return m;
      const updated = { ...m, ...changes };
      if (changes.app_field) {
        updated.app_field_label = APP_FIELDS.find(f => f.value === changes.app_field)?.label || changes.app_field;
      }
      return updated;
    }));
  }

  function removeStandardMapping(index: number) {
    setStandardMappings(prev => prev.filter((_, i) => i !== index));
  }

  async function saveStandardMappings() {
    if (!profile?.is_admin) return;
    setSavingStandard(true);
    setError(null);
    try {
      const { error: delErr } = await supabase
        .from('clickup_standard_field_mappings')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw delErr;

      const toInsert = standardMappings
        .filter(m => m.app_field)
        .map((m, i) => ({
          field_target: m.field_target,
          label: m.label,
          app_field: m.app_field,
          app_field_label: m.app_field_label,
          enabled: m.enabled,
          sort_order: i,
        }));

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from('clickup_standard_field_mappings')
          .insert(toInsert);
        if (insErr) throw insErr;
      }

      await loadAll();
      setSuccess('Mapowanie pol podstawowych zapisane pomyslnie');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: unknown) {
      setError((err as Error).message || 'Nie udalo sie zapisac mapowania pol podstawowych');
    } finally {
      setSavingStandard(false);
    }
  }

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  }

  const availableClickUpFields = (config.cached_custom_fields || []).filter(
    f => !mappings.some(m => m.clickup_field_id === f.id)
  );

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

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {(['config', 'standard', 'mappings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
            }`}
          >
            {tab === 'config' ? 'Konfiguracja' : tab === 'standard' ? 'Pola podstawowe' : 'Pola custom'}
            {tab === 'standard' && standardMappings.length > 0 && (
              <span className="ml-1.5 text-xs bg-brand-primary/10 text-brand-primary rounded-full px-1.5 py-0.5">
                {standardMappings.length}
              </span>
            )}
            {tab === 'mappings' && mappings.length > 0 && (
              <span className="ml-1.5 text-xs bg-brand-primary/10 text-brand-primary rounded-full px-1.5 py-0.5">
                {mappings.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'config' && (
        <>
          <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">Konfiguracja ClickUp</h3>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                  Zaakceptowane wnioski zakupowe beda automatycznie tworzyc zadania w ClickUp
                </p>
              </div>
              <button
                onClick={() => profile?.is_admin && setConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                disabled={!profile?.is_admin}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  config.enabled
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-text-secondary-light dark:text-text-secondary-dark'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {config.enabled
                  ? <><ToggleRight className="w-4 h-4" /> Wlaczona</>
                  : <><ToggleLeft className="w-4 h-4" /> Wylaczona</>
                }
              </button>
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
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.list_id}
                    onChange={e => setConfig(prev => ({ ...prev, list_id: e.target.value }))}
                    disabled={!profile?.is_admin}
                    placeholder="np. 901234567890"
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark disabled:opacity-50"
                  />
                  {profile?.is_admin && config.api_token && config.list_id && (
                    <button
                      onClick={fetchListFields}
                      disabled={fetchingFields}
                      className="px-3 py-2 text-xs font-medium border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors text-text-primary-light dark:text-text-primary-dark whitespace-nowrap flex items-center gap-1.5"
                    >
                      {fetchingFields
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />
                      }
                      Pobierz pola custom
                    </button>
                  )}
                </div>
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
              Dodaj ten URL jako Webhook w ClickUp, aby zmiana statusu automatycznie oznaczala wniosek jako oplacony.
            </p>
            <div className="flex items-center gap-2 mb-4">
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
            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5">
                Nazwa statusu "Oplacono" w ClickUp
              </label>
              <input
                type="text"
                value={config.paid_status}
                onChange={e => setConfig(prev => ({ ...prev, paid_status: e.target.value }))}
                placeholder='np. Oplacono, paid, complete...'
                disabled={!profile?.is_admin}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-dark-surface-2 text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 disabled:opacity-60"
              />
              <p className="mt-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Wpisz dokladnie tak jak nazywa sie status w ClickUp (wielkosc liter nie ma znaczenia). Jezeli pole jest puste, system uzyje domyslnych angielskich statusow (complete, done, closed, paid).
              </p>
            </div>
          </div>
        </>
      )}

      {activeTab === 'standard' && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-3">
            <p className="text-xs text-blue-800 dark:text-blue-300">
              <strong>Pola podstawowe ClickUp</strong> to standardowe pola kazdego zadania: nazwa, opis i priorytet.
              Mozesz skonfigurowac, ktore dane z wniosku zakupowego trafiaja do tych pol.
              Jesli nie skonfigurujesz opisu, zostanie uzyty domyslny szablon ze wszystkimi polami.
            </p>
          </div>

          {STANDARD_CLICKUP_FIELDS.map(targetField => {
            const Icon = targetField.icon;
            const lines = standardMappings
              .map((m, idx) => ({ ...m, _idx: idx }))
              .filter(m => m.field_target === targetField.value);

            return (
              <div
                key={targetField.value}
                className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                        {targetField.label}
                      </p>
                      {targetField.value === 'description' && (
                        <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
                          Kazda linia ponizej to osobna linia w opisie zadania ClickUp
                        </p>
                      )}
                      {targetField.value === 'name' && (
                        <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
                          Pierwsze pole staje sie nazwa zadania (jesli brak - uzyty zostanie domyslny schemat)
                        </p>
                      )}
                      {targetField.value === 'priority' && (
                        <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
                          Mapowanie priorytetu z wniosku (automatyczne)
                        </p>
                      )}
                    </div>
                  </div>
                  {profile?.is_admin && targetField.value !== 'priority' && (
                    <button
                      onClick={() => addStandardLine(targetField.value)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-dashed border-slate-300 dark:border-slate-600 rounded-lg hover:border-brand-primary hover:text-brand-primary dark:hover:border-brand-primary transition-colors text-text-secondary-light dark:text-text-secondary-dark"
                    >
                      <Plus className="w-3 h-3" />
                      Dodaj linie
                    </button>
                  )}
                </div>

                {targetField.value === 'priority' ? (
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50 p-3">
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-2">
                      Priorytet jest mapowany automatycznie z pola "Priorytet" we wniosku zakupowym:
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      {[
                        { from: 'pilny / urgent', to: 'Pilny (1)', color: 'text-red-600 dark:text-red-400' },
                        { from: 'wysoki / high', to: 'Wysoki (2)', color: 'text-orange-600 dark:text-orange-400' },
                        { from: 'normalny / normal', to: 'Normalny (3)', color: 'text-yellow-600 dark:text-yellow-400' },
                        { from: 'niski / low', to: 'Niski (4)', color: 'text-slate-500 dark:text-slate-400' },
                      ].map(row => (
                        <div key={row.from} className="flex items-center gap-1.5">
                          <span className="text-text-secondary-light dark:text-text-secondary-dark">{row.from}</span>
                          <ArrowRight className="w-3 h-3 flex-shrink-0 text-text-secondary-light dark:text-text-secondary-dark" />
                          <span className={`font-medium ${row.color}`}>{row.to}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : lines.length === 0 ? (
                  <div className="text-center py-5 rounded-lg border border-dashed border-slate-200 dark:border-slate-700/50">
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {targetField.value === 'description'
                        ? 'Brak konfiguracji - zostanie uzyty domyslny szablon opisu'
                        : 'Brak konfiguracji - zostanie uzyta domyslna nazwa zadania'}
                    </p>
                    {profile?.is_admin && (
                      <button
                        onClick={() => addStandardLine(targetField.value)}
                        className="mt-2 text-xs text-brand-primary hover:underline"
                      >
                        Dodaj pierwsza linie
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {lines.map((mapping, lineIdx) => (
                      <div
                        key={lineIdx}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border transition-colors ${
                          mapping.enabled
                            ? 'border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/30'
                            : 'border-slate-200 dark:border-slate-700/30 bg-slate-50/50 dark:bg-slate-800/10 opacity-60'
                        }`}
                      >
                        <GripVertical className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 cursor-grab" />
                        <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
                          {targetField.value === 'description' && (
                            <input
                              type="text"
                              value={mapping.label}
                              onChange={e => updateStandardMapping(mapping._idx!, { label: e.target.value })}
                              disabled={!profile?.is_admin}
                              placeholder="Etykieta (np. Kwota:)"
                              className="w-32 px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                            />
                          )}
                          <select
                            value={mapping.app_field}
                            onChange={e => updateStandardMapping(mapping._idx!, { app_field: e.target.value })}
                            disabled={!profile?.is_admin}
                            className="flex-1 min-w-[140px] text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                          >
                            <option value="">-- wybierz pole wniosku --</option>
                            {APP_FIELDS.map(f => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                          {mapping.app_field && (
                            <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono truncate max-w-[120px]">
                              {mapping.label
                                ? `${mapping.label} [wartosc]`
                                : `[${APP_FIELDS.find(f => f.value === mapping.app_field)?.label || mapping.app_field}]`
                              }
                            </span>
                          )}
                        </div>
                        {profile?.is_admin && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => updateStandardMapping(mapping._idx!, { enabled: !mapping.enabled })}
                              className={`p-1 rounded transition-colors ${
                                mapping.enabled
                                  ? 'text-green-600 hover:text-green-700 dark:text-green-400'
                                  : 'text-slate-400 hover:text-slate-500'
                              }`}
                              title={mapping.enabled ? 'Wylacz' : 'Wlacz'}
                            >
                              {mapping.enabled
                                ? <ToggleRight className="w-4 h-4" />
                                : <ToggleLeft className="w-4 h-4" />
                              }
                            </button>
                            <button
                              onClick={() => removeStandardMapping(mapping._idx!)}
                              className="p-1 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                              title="Usun linie"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                    {targetField.value === 'description' && lines.filter(m => m.enabled && m.app_field).length > 0 && (
                      <div className="mt-2 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/40 p-3">
                        <p className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 uppercase tracking-wide">
                          Podglad opisu
                        </p>
                        {lines.filter(m => m.enabled && m.app_field).map((m, i) => (
                          <p key={i} className="text-xs text-text-primary-light dark:text-text-primary-dark font-mono leading-relaxed">
                            {m.label
                              ? <><strong>{m.label}</strong>{' [wartosc]'}</>
                              : `[${APP_FIELDS.find(f => f.value === m.app_field)?.label || m.app_field}]`
                            }
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {profile?.is_admin && standardMappings.filter(m => m.app_field).length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={saveStandardMappings}
                disabled={savingStandard}
                className="flex items-center gap-2 px-4 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {savingStandard ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Zapisz pola podstawowe
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'mappings' && (
        <div className="space-y-4">
          <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                  Mapowanie pol wniosku &rarr; pola custom ClickUp
                </h3>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                  Przypisz pola z wniosku zakupowego do pol custom w ClickUp. Najpierw pobierz pola z listy.
                </p>
              </div>
              {profile?.is_admin && mappings.length > 0 && (
                <button
                  onClick={saveMappings}
                  disabled={savingMappings}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  {savingMappings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Zapisz mapowanie
                </button>
              )}
            </div>

            {mappings.length === 0 && (config.cached_custom_fields || []).length === 0 && (
              <div className="text-center py-8 text-text-secondary-light dark:text-text-secondary-dark">
                <p className="text-sm mb-3">Brak pobranych pol custom z ClickUp.</p>
                <p className="text-xs mb-4">Przejdz do zakladki Konfiguracja, wpisz ID listy i kliknij "Pobierz pola custom".</p>
                <button
                  onClick={() => setActiveTab('config')}
                  className="text-xs text-brand-primary hover:underline"
                >
                  Przejdz do Konfiguracji
                </button>
              </div>
            )}

            {mappings.length > 0 && (
              <div className="space-y-2 mb-4">
                {mappings.map((mapping, index) => (
                  <div
                    key={index}
                    className={`flex items-center gap-2 p-3 rounded-lg border transition-colors ${
                      mapping.enabled
                        ? 'border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/30'
                        : 'border-slate-200 dark:border-slate-700/30 bg-slate-50/50 dark:bg-slate-800/10 opacity-60'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark truncate max-w-[160px]">
                          {mapping.clickup_field_name}
                        </span>
                        <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-text-secondary-light dark:text-text-secondary-dark px-1.5 py-0.5 rounded">
                          {mapping.clickup_field_type}
                        </span>
                        <ArrowRight className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0" />
                        <select
                          value={mapping.app_field}
                          onChange={e => updateMappingAppField(index, e.target.value)}
                          disabled={!profile?.is_admin}
                          className="text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:opacity-50"
                        >
                          <option value="">-- wybierz pole wniosku --</option>
                          {APP_FIELDS.map(f => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {profile?.is_admin && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => toggleMapping(index)}
                          className={`p-1 rounded transition-colors ${
                            mapping.enabled
                              ? 'text-green-600 hover:text-green-700 dark:text-green-400'
                              : 'text-slate-400 hover:text-slate-500'
                          }`}
                          title={mapping.enabled ? 'Wylacz' : 'Wlacz'}
                        >
                          {mapping.enabled
                            ? <ToggleRight className="w-4 h-4" />
                            : <ToggleLeft className="w-4 h-4" />
                          }
                        </button>
                        <button
                          onClick={() => removeMapping(index)}
                          className="p-1 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          title="Usun mapowanie"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {profile?.is_admin && (config.cached_custom_fields || []).length > 0 && (
              <>
                {availableClickUpFields.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-2">
                      Dostepne pola custom ClickUp (kliknij, aby dodac mapowanie):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {availableClickUpFields.map(field => (
                        <button
                          key={field.id}
                          onClick={() => addMapping(field)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs border border-dashed border-slate-300 dark:border-slate-600 rounded-lg hover:border-brand-primary hover:text-brand-primary dark:hover:border-brand-primary transition-colors text-text-secondary-light dark:text-text-secondary-dark"
                        >
                          <Plus className="w-3 h-3" />
                          {field.name}
                          <span className="text-[10px] opacity-60">({field.type})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {availableClickUpFields.length === 0 && mappings.length > 0 && (
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark text-center py-2">
                    Wszystkie pola custom z listy zostaly juz zmapowane.
                  </p>
                )}
                {profile?.is_admin && mappings.length > 0 && (
                  <div className="mt-4 flex justify-end border-t border-slate-200 dark:border-slate-700 pt-3">
                    <button
                      onClick={saveMappings}
                      disabled={savingMappings}
                      className="flex items-center gap-2 px-4 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                    >
                      {savingMappings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Zapisz mapowanie pol
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-4">
            <div className="flex items-start gap-2">
              <ExternalLink className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">Jak dziala mapowanie pol custom?</p>
                <ol className="text-xs text-blue-700 dark:text-blue-400 space-y-1 list-decimal list-inside">
                  <li>W zakladce Konfiguracja wpisz token i ID listy, kliknij "Pobierz pola custom"</li>
                  <li>Tutaj zobaczysz pola custom z Twojej listy ClickUp</li>
                  <li>Kliknij pole, aby dodac je do mapowania, a nastepnie wybierz odpowiednie pole z wniosku</li>
                  <li>Zapisz mapowanie - od teraz kazdy nowy wniosek bedzie wypelnial te pola w ClickUp</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
