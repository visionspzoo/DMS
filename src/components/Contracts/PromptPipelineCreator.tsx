import { useState } from 'react';
import { X, Save, Plus, Trash2, ChevronUp, ChevronDown, Sparkles, GitBranch, GripVertical } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface StepDraft {
  step_name: string;
  prompt_text: string;
}

interface PromptPipelineCreatorProps {
  userId: string;
  initialMode: 'prompt' | 'pipeline';
  onClose: () => void;
  onCreated: () => void;
}

export default function PromptPipelineCreator({ userId, initialMode, onClose, onCreated }: PromptPipelineCreatorProps) {
  const [mode, setMode] = useState<'prompt' | 'pipeline'>(initialMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [promptName, setPromptName] = useState('');
  const [promptText, setPromptText] = useState('');

  const [pipelineName, setPipelineName] = useState('');
  const [pipelineDesc, setPipelineDesc] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([{ step_name: '', prompt_text: '' }]);

  function addStep() {
    setSteps(prev => [...prev, { step_name: '', prompt_text: '' }]);
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= steps.length) return;
    setSteps(prev => {
      const copy = [...prev];
      [copy[index], copy[newIndex]] = [copy[newIndex], copy[index]];
      return copy;
    });
  }

  function updateStep(index: number, field: keyof StepDraft, value: string) {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  async function handleSave() {
    setError(null);

    if (mode === 'prompt') {
      if (!promptName.trim() || !promptText.trim()) {
        setError('Nazwa i tresc prompta sa wymagane');
        return;
      }
      setSaving(true);
      try {
        const { error: err } = await supabase
          .from('contract_ai_prompts')
          .insert({ user_id: userId, name: promptName.trim(), prompt_text: promptText.trim() });
        if (err) throw err;
        onCreated();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nie udalo sie zapisac');
      } finally {
        setSaving(false);
      }
    } else {
      if (!pipelineName.trim()) {
        setError('Nazwa pipeline jest wymagana');
        return;
      }
      const validSteps = steps.filter(s => s.step_name.trim() && s.prompt_text.trim());
      if (validSteps.length === 0) {
        setError('Pipeline musi miec co najmniej jeden krok z nazwa i trescia');
        return;
      }
      setSaving(true);
      try {
        const { data, error: pErr } = await supabase
          .from('contract_pipelines')
          .insert({
            name: pipelineName.trim(),
            description: pipelineDesc.trim(),
            created_by: userId,
            user_id: userId,
          })
          .select('id')
          .single();
        if (pErr) throw pErr;

        const rows = validSteps.map((s, i) => ({
          pipeline_id: data.id,
          step_order: i,
          step_name: s.step_name.trim(),
          prompt_text: s.prompt_text.trim(),
        }));
        const { error: sErr } = await supabase.from('contract_pipeline_steps').insert(rows);
        if (sErr) throw sErr;

        onCreated();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nie udalo sie zapisac');
      } finally {
        setSaving(false);
      }
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden border border-slate-200 dark:border-slate-700/50 flex flex-col">
        <div className="px-5 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between rounded-t-xl flex-shrink-0">
          <h3 className="font-semibold text-text-primary-light dark:text-text-primary-dark text-sm">
            Nowy {mode === 'prompt' ? 'prompt' : 'pipeline'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors">
            <X className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <div className="flex gap-1 bg-slate-100 dark:bg-dark-surface-variant rounded-lg p-0.5">
            <button
              onClick={() => setMode('prompt')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'prompt' ? 'bg-brand-primary text-white shadow-sm' : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              Prompt
            </button>
            <button
              onClick={() => setMode('pipeline')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'pipeline' ? 'bg-teal-600 text-white shadow-sm' : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light'
              }`}
            >
              <GitBranch className="w-3 h-3" />
              Pipeline
            </button>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2.5 text-red-700 dark:text-red-300 text-xs">
              {error}
            </div>
          )}

          {mode === 'prompt' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">Nazwa</label>
                <input
                  value={promptName}
                  onChange={e => setPromptName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
                  placeholder="np. Analiza ryzyk"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">Tresc prompta</label>
                <textarea
                  value={promptText}
                  onChange={e => setPromptText(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm resize-none"
                  placeholder="Wpisz tresc prompta..."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">Nazwa pipeline</label>
                <input
                  value={pipelineName}
                  onChange={e => setPipelineName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
                  placeholder="np. Pelna analiza umowy"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">Opis (opcjonalny)</label>
                <input
                  value={pipelineDesc}
                  onChange={e => setPipelineDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
                  placeholder="Krotki opis..."
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
                    Kroki ({steps.length})
                  </label>
                  <button
                    onClick={addStep}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-brand-primary hover:bg-blue-50 dark:hover:bg-blue-900/10 rounded transition-colors font-medium"
                  >
                    <Plus className="w-3 h-3" />
                    Dodaj krok
                  </button>
                </div>

                <div className="space-y-2">
                  {steps.map((step, idx) => (
                    <div key={idx} className="border border-slate-200 dark:border-slate-700/50 rounded-lg p-2.5 bg-slate-50 dark:bg-dark-surface-variant">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <GripVertical className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0" />
                        <span className="text-xs font-bold text-brand-primary w-4 text-center flex-shrink-0">{idx + 1}</span>
                        <input
                          value={step.step_name}
                          onChange={e => updateStep(idx, 'step_name', e.target.value)}
                          className="flex-1 px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded text-xs bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                          placeholder="Nazwa kroku..."
                        />
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => moveStep(idx, -1)}
                            disabled={idx === 0}
                            className="p-0.5 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors disabled:opacity-30"
                          >
                            <ChevronUp className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                          </button>
                          <button
                            onClick={() => moveStep(idx, 1)}
                            disabled={idx === steps.length - 1}
                            className="p-0.5 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors disabled:opacity-30"
                          >
                            <ChevronDown className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                          </button>
                          <button
                            onClick={() => removeStep(idx)}
                            disabled={steps.length <= 1}
                            className="p-0.5 hover:bg-red-50 dark:hover:bg-red-900/10 rounded transition-colors disabled:opacity-30"
                          >
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={step.prompt_text}
                        onChange={e => updateStep(idx, 'prompt_text', e.target.value)}
                        rows={2}
                        className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded text-xs bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark resize-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                        placeholder="Tresc prompta dla tego kroku..."
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700/50 flex gap-2 flex-shrink-0">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-white font-medium rounded-lg transition-colors disabled:opacity-50 text-sm ${
              mode === 'pipeline' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-brand-primary hover:bg-brand-primary-hover'
            }`}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-text-secondary-light dark:text-text-secondary-dark font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors text-sm"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
