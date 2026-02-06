import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Plus, Trash2, Save, X, AlertCircle, Shield, ChevronUp, ChevronDown,
  Eye, EyeOff, Pencil, Sparkles, GitBranch, GripVertical,
} from 'lucide-react';

interface AdminPrompt {
  id: string;
  name: string;
  prompt_text: string;
  is_active: boolean;
  created_at: string;
}

interface PipelineStep {
  id?: string;
  step_name: string;
  prompt_text: string;
  step_order: number;
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  steps: PipelineStep[];
}

type Tab = 'prompts' | 'pipelines';

export default function AIPromptsSettings() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('prompts');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [adminPrompts, setAdminPrompts] = useState<AdminPrompt[]>([]);
  const [showPromptForm, setShowPromptForm] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptForm, setPromptForm] = useState({ name: '', prompt_text: '' });

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [showPipelineForm, setShowPipelineForm] = useState(false);
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null);
  const [pipelineForm, setPipelineForm] = useState({ name: '', description: '' });
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([]);

  useEffect(() => {
    loadAll();
  }, []);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadAdminPrompts(), loadPipelines()]);
    setLoading(false);
  }

  async function loadAdminPrompts() {
    try {
      const { data, error: err } = await supabase
        .from('contract_admin_prompts')
        .select('*')
        .order('created_at', { ascending: false });
      if (err) throw err;
      setAdminPrompts(data || []);
    } catch (err) {
      console.error('Error loading admin prompts:', err);
    }
  }

  async function loadPipelines() {
    try {
      const { data, error: err } = await supabase
        .from('contract_pipelines')
        .select('*, steps:contract_pipeline_steps(*)')
        .order('created_at', { ascending: false });
      if (err) throw err;
      const sorted = (data || []).map((p: any) => ({
        ...p,
        steps: (p.steps || []).sort((a: PipelineStep, b: PipelineStep) => a.step_order - b.step_order),
      }));
      setPipelines(sorted);
    } catch (err) {
      console.error('Error loading pipelines:', err);
    }
  }

  function openPromptForm(prompt?: AdminPrompt) {
    if (prompt) {
      setEditingPromptId(prompt.id);
      setPromptForm({ name: prompt.name, prompt_text: prompt.prompt_text });
    } else {
      setEditingPromptId(null);
      setPromptForm({ name: '', prompt_text: '' });
    }
    setShowPromptForm(true);
    setError(null);
  }

  function closePromptForm() {
    setShowPromptForm(false);
    setEditingPromptId(null);
    setPromptForm({ name: '', prompt_text: '' });
    setError(null);
  }

  async function savePrompt() {
    if (!user || !promptForm.name.trim() || !promptForm.prompt_text.trim()) {
      setError('Nazwa i tresc prompta sa wymagane');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingPromptId) {
        const { error: err } = await supabase
          .from('contract_admin_prompts')
          .update({ name: promptForm.name.trim(), prompt_text: promptForm.prompt_text.trim() })
          .eq('id', editingPromptId);
        if (err) throw err;
        showSuccess('Prompt zaktualizowany');
      } else {
        const { error: err } = await supabase
          .from('contract_admin_prompts')
          .insert({ name: promptForm.name.trim(), prompt_text: promptForm.prompt_text.trim(), created_by: user.id });
        if (err) throw err;
        showSuccess('Prompt utworzony');
      }
      closePromptForm();
      await loadAdminPrompts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udalo sie zapisac prompta');
    } finally {
      setSaving(false);
    }
  }

  async function togglePromptActive(id: string, currentActive: boolean) {
    try {
      const { error: err } = await supabase
        .from('contract_admin_prompts')
        .update({ is_active: !currentActive })
        .eq('id', id);
      if (err) throw err;
      await loadAdminPrompts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Blad zmiany statusu');
    }
  }

  async function deletePrompt(id: string) {
    if (!confirm('Czy na pewno chcesz usunac ten prompt?')) return;
    try {
      const { error: err } = await supabase
        .from('contract_admin_prompts')
        .delete()
        .eq('id', id);
      if (err) throw err;
      showSuccess('Prompt usuniety');
      await loadAdminPrompts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udalo sie usunac prompta');
    }
  }

  function openPipelineForm(pipeline?: Pipeline) {
    if (pipeline) {
      setEditingPipelineId(pipeline.id);
      setPipelineForm({ name: pipeline.name, description: pipeline.description });
      setPipelineSteps(pipeline.steps.map(s => ({ ...s })));
    } else {
      setEditingPipelineId(null);
      setPipelineForm({ name: '', description: '' });
      setPipelineSteps([{ step_name: '', prompt_text: '', step_order: 0 }]);
    }
    setShowPipelineForm(true);
    setError(null);
  }

  function closePipelineForm() {
    setShowPipelineForm(false);
    setEditingPipelineId(null);
    setPipelineForm({ name: '', description: '' });
    setPipelineSteps([]);
    setError(null);
  }

  function addStep() {
    setPipelineSteps(prev => [...prev, {
      step_name: '',
      prompt_text: '',
      step_order: prev.length,
    }]);
  }

  function removeStep(index: number) {
    setPipelineSteps(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i })));
  }

  function moveStep(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= pipelineSteps.length) return;
    setPipelineSteps(prev => {
      const copy = [...prev];
      [copy[index], copy[newIndex]] = [copy[newIndex], copy[index]];
      return copy.map((s, i) => ({ ...s, step_order: i }));
    });
  }

  function updateStep(index: number, field: 'step_name' | 'prompt_text', value: string) {
    setPipelineSteps(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  async function savePipeline() {
    if (!user || !pipelineForm.name.trim()) {
      setError('Nazwa pipeline jest wymagana');
      return;
    }
    const validSteps = pipelineSteps.filter(s => s.step_name.trim() && s.prompt_text.trim());
    if (validSteps.length === 0) {
      setError('Pipeline musi miec co najmniej jeden krok z nazwa i trescia');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let pipelineId = editingPipelineId;
      if (editingPipelineId) {
        const { error: err } = await supabase
          .from('contract_pipelines')
          .update({ name: pipelineForm.name.trim(), description: pipelineForm.description.trim() })
          .eq('id', editingPipelineId);
        if (err) throw err;
        const { error: delErr } = await supabase
          .from('contract_pipeline_steps')
          .delete()
          .eq('pipeline_id', editingPipelineId);
        if (delErr) throw delErr;
      } else {
        const { data, error: err } = await supabase
          .from('contract_pipelines')
          .insert({ name: pipelineForm.name.trim(), description: pipelineForm.description.trim(), created_by: user.id })
          .select('id')
          .single();
        if (err) throw err;
        pipelineId = data.id;
      }

      const rows = validSteps.map((s, i) => ({
        pipeline_id: pipelineId!,
        step_order: i,
        step_name: s.step_name.trim(),
        prompt_text: s.prompt_text.trim(),
      }));
      const { error: stepErr } = await supabase.from('contract_pipeline_steps').insert(rows);
      if (stepErr) throw stepErr;

      showSuccess(editingPipelineId ? 'Pipeline zaktualizowany' : 'Pipeline utworzony');
      closePipelineForm();
      await loadPipelines();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udalo sie zapisac pipeline');
    } finally {
      setSaving(false);
    }
  }

  async function togglePipelineActive(id: string, currentActive: boolean) {
    try {
      const { error: err } = await supabase
        .from('contract_pipelines')
        .update({ is_active: !currentActive })
        .eq('id', id);
      if (err) throw err;
      await loadPipelines();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Blad zmiany statusu');
    }
  }

  async function deletePipeline(id: string) {
    if (!confirm('Czy na pewno chcesz usunac ten pipeline? Wszystkie kroki zostana usuniete.')) return;
    try {
      const { error: err } = await supabase.from('contract_pipelines').delete().eq('id', id);
      if (err) throw err;
      showSuccess('Pipeline usuniety');
      await loadPipelines();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udalo sie usunac pipeline');
    }
  }

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
          <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
          <Shield className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-green-700 dark:text-green-300 text-sm">{success}</p>
        </div>
      )}

      <div className="flex items-center gap-2 bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-1">
        <button
          onClick={() => setActiveTab('prompts')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
            activeTab === 'prompts'
              ? 'bg-brand-primary text-white'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Prompty
        </button>
        <button
          onClick={() => setActiveTab('pipelines')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
            activeTab === 'pipelines'
              ? 'bg-brand-primary text-white'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <GitBranch className="w-4 h-4" />
          Pipeline
        </button>
      </div>

      {activeTab === 'prompts' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              Prompty systemowe widoczne dla wszystkich uzytkownikow
            </p>
            <button
              onClick={() => openPromptForm()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white text-sm font-medium rounded-lg hover:bg-brand-primary-hover transition-colors"
            >
              <Plus className="w-4 h-4" />
              Dodaj prompt
            </button>
          </div>

          {adminPrompts.length === 0 ? (
            <div className="text-center py-8 text-text-secondary-light dark:text-text-secondary-dark text-sm">
              Brak promptow systemowych
            </div>
          ) : (
            <div className="space-y-2">
              {adminPrompts.map(prompt => (
                <div
                  key={prompt.id}
                  className={`bg-light-surface dark:bg-dark-surface border rounded-lg p-3 ${
                    prompt.is_active
                      ? 'border-slate-200 dark:border-slate-700/50'
                      : 'border-slate-200/50 dark:border-slate-700/30 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm text-text-primary-light dark:text-text-primary-dark truncate">
                          {prompt.name}
                        </h4>
                        {!prompt.is_active && (
                          <span className="text-xs px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-text-secondary-light dark:text-text-secondary-dark">
                            Nieaktywny
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1 line-clamp-2">
                        {prompt.prompt_text}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => togglePromptActive(prompt.id, prompt.is_active)}
                        className="p-1.5 rounded hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors"
                        title={prompt.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                      >
                        {prompt.is_active
                          ? <Eye className="w-4 h-4 text-green-600" />
                          : <EyeOff className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                        }
                      </button>
                      <button
                        onClick={() => openPromptForm(prompt)}
                        className="p-1.5 rounded hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors"
                      >
                        <Pencil className="w-4 h-4 text-brand-primary" />
                      </button>
                      <button
                        onClick={() => deletePrompt(prompt.id)}
                        className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'pipelines' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              Pipeline to sekwencja promptow wykonywanych po kolei
            </p>
            <button
              onClick={() => openPipelineForm()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white text-sm font-medium rounded-lg hover:bg-brand-primary-hover transition-colors"
            >
              <Plus className="w-4 h-4" />
              Dodaj pipeline
            </button>
          </div>

          {pipelines.length === 0 ? (
            <div className="text-center py-8 text-text-secondary-light dark:text-text-secondary-dark text-sm">
              Brak pipeline
            </div>
          ) : (
            <div className="space-y-2">
              {pipelines.map(pipeline => (
                <div
                  key={pipeline.id}
                  className={`bg-light-surface dark:bg-dark-surface border rounded-lg p-3 ${
                    pipeline.is_active
                      ? 'border-slate-200 dark:border-slate-700/50'
                      : 'border-slate-200/50 dark:border-slate-700/30 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm text-text-primary-light dark:text-text-primary-dark truncate">
                          {pipeline.name}
                        </h4>
                        <span className="text-xs px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded">
                          {pipeline.steps.length} {pipeline.steps.length === 1 ? 'krok' : pipeline.steps.length < 5 ? 'kroki' : 'krokow'}
                        </span>
                        {!pipeline.is_active && (
                          <span className="text-xs px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-text-secondary-light dark:text-text-secondary-dark">
                            Nieaktywny
                          </span>
                        )}
                      </div>
                      {pipeline.description && (
                        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                          {pipeline.description}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {pipeline.steps.map((step, i) => (
                          <span
                            key={i}
                            className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-text-secondary-light dark:text-text-secondary-dark rounded-full"
                          >
                            {i + 1}. {step.step_name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => togglePipelineActive(pipeline.id, pipeline.is_active)}
                        className="p-1.5 rounded hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors"
                        title={pipeline.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                      >
                        {pipeline.is_active
                          ? <Eye className="w-4 h-4 text-green-600" />
                          : <EyeOff className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                        }
                      </button>
                      <button
                        onClick={() => openPipelineForm(pipeline)}
                        className="p-1.5 rounded hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors"
                      >
                        <Pencil className="w-4 h-4 text-brand-primary" />
                      </button>
                      <button
                        onClick={() => deletePipeline(pipeline.id)}
                        className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showPromptForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl max-w-lg w-full border border-slate-200 dark:border-slate-700/50">
            <div className="px-5 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between rounded-t-xl">
              <h3 className="font-semibold text-text-primary-light dark:text-text-primary-dark">
                {editingPromptId ? 'Edytuj prompt' : 'Nowy prompt systemowy'}
              </h3>
              <button onClick={closePromptForm} className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors">
                <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1">Nazwa</label>
                <input
                  value={promptForm.name}
                  onChange={e => setPromptForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
                  placeholder="np. Analiza ryzyk prawnych"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1">Tresc prompta</label>
                <textarea
                  value={promptForm.prompt_text}
                  onChange={e => setPromptForm(p => ({ ...p, prompt_text: e.target.value }))}
                  rows={6}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm resize-none"
                  placeholder="Wpisz tresc prompta dla AI..."
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={savePrompt}
                  disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary-hover transition-colors disabled:opacity-50 text-sm"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Zapisywanie...' : 'Zapisz'}
                </button>
                <button
                  onClick={closePromptForm}
                  className="px-4 py-2.5 text-text-secondary-light dark:text-text-secondary-dark font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors text-sm"
                >
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPipelineForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden border border-slate-200 dark:border-slate-700/50 flex flex-col">
            <div className="px-5 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between rounded-t-xl flex-shrink-0">
              <h3 className="font-semibold text-text-primary-light dark:text-text-primary-dark">
                {editingPipelineId ? 'Edytuj pipeline' : 'Nowy pipeline'}
              </h3>
              <button onClick={closePipelineForm} className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors">
                <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1">Nazwa</label>
                  <input
                    value={pipelineForm.name}
                    onChange={e => setPipelineForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
                    placeholder="np. Pelna analiza umowy"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1">Opis (opcjonalny)</label>
                  <input
                    value={pipelineForm.description}
                    onChange={e => setPipelineForm(p => ({ ...p, description: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
                    placeholder="Krotki opis pipeline..."
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                    Kroki ({pipelineSteps.length})
                  </label>
                  <button
                    onClick={addStep}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-brand-primary hover:bg-blue-50 dark:hover:bg-blue-900/10 rounded transition-colors font-medium"
                  >
                    <Plus className="w-3 h-3" />
                    Dodaj krok
                  </button>
                </div>

                <div className="space-y-3">
                  {pipelineSteps.map((step, idx) => (
                    <div key={idx} className="border border-slate-200 dark:border-slate-700/50 rounded-lg p-3 bg-slate-50 dark:bg-dark-surface-variant">
                      <div className="flex items-center gap-2 mb-2">
                        <GripVertical className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0" />
                        <span className="text-xs font-bold text-brand-primary w-5 text-center flex-shrink-0">{idx + 1}</span>
                        <input
                          value={step.step_name}
                          onChange={e => updateStep(idx, 'step_name', e.target.value)}
                          className="flex-1 px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded text-sm bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                          placeholder="Nazwa kroku..."
                        />
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => moveStep(idx, -1)}
                            disabled={idx === 0}
                            className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors disabled:opacity-30"
                          >
                            <ChevronUp className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
                          </button>
                          <button
                            onClick={() => moveStep(idx, 1)}
                            disabled={idx === pipelineSteps.length - 1}
                            className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors disabled:opacity-30"
                          >
                            <ChevronDown className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
                          </button>
                          <button
                            onClick={() => removeStep(idx)}
                            disabled={pipelineSteps.length <= 1}
                            className="p-1 hover:bg-red-50 dark:hover:bg-red-900/10 rounded transition-colors disabled:opacity-30"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={step.prompt_text}
                        onChange={e => updateStep(idx, 'prompt_text', e.target.value)}
                        rows={3}
                        className="w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded text-sm bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark resize-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                        placeholder="Tresc prompta dla tego kroku..."
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={savePipeline}
                  disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary-hover transition-colors disabled:opacity-50 text-sm"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Zapisywanie...' : 'Zapisz pipeline'}
                </button>
                <button
                  onClick={closePipelineForm}
                  className="px-4 py-2.5 text-text-secondary-light dark:text-text-secondary-dark font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors text-sm"
                >
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
