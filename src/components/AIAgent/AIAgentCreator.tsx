import { useState, useEffect } from 'react';
import { X, Save, Plus, Trash2, ChevronUp, ChevronDown, GripVertical, Bot, Sparkles, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { LLMModel } from './ModelSelector';
import type { CustomAgent } from './AIAgentSidebar';

interface StepDraft {
  step_name: string;
  prompt_text: string;
}

interface AIAgentCreatorProps {
  userId: string;
  editAgent?: CustomAgent | null;
  onClose: () => void;
  onSaved: () => void;
}

const MODEL_OPTIONS: { id: LLMModel | ''; label: string }[] = [
  { id: '', label: 'Domyslny' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];

export default function AIAgentCreator({ userId, editAgent, onClose, onSaved }: AIAgentCreatorProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState<string>('');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [hasPipeline, setHasPipeline] = useState(false);

  useEffect(() => {
    if (editAgent) {
      setName(editAgent.name);
      setDescription(editAgent.description);
      setSystemPrompt(editAgent.system_prompt);
      setModel(editAgent.model || '');
      if (editAgent.steps && editAgent.steps.length > 0) {
        setSteps(editAgent.steps.map((s) => ({ step_name: s.step_name, prompt_text: s.prompt_text })));
        setHasPipeline(true);
      }
    }
  }, [editAgent]);

  function addStep() {
    setSteps((prev) => [...prev, { step_name: '', prompt_text: '' }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= steps.length) return;
    setSteps((prev) => {
      const copy = [...prev];
      [copy[index], copy[newIndex]] = [copy[newIndex], copy[index]];
      return copy;
    });
  }

  function updateStep(index: number, field: keyof StepDraft, value: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  async function handleSave() {
    setError(null);

    if (!name.trim()) {
      setError('Nazwa agenta jest wymagana');
      return;
    }
    if (!systemPrompt.trim()) {
      setError('Prompt systemowy jest wymagany');
      return;
    }

    if (hasPipeline) {
      const validSteps = steps.filter((s) => s.step_name.trim() && s.prompt_text.trim());
      if (validSteps.length === 0) {
        setError('Pipeline musi miec co najmniej jeden krok z nazwa i trescia');
        return;
      }
    }

    setSaving(true);

    try {
      if (editAgent) {
        const { error: updateErr } = await supabase
          .from('ai_custom_agents')
          .update({
            name: name.trim(),
            description: description.trim(),
            system_prompt: systemPrompt.trim(),
            model: model || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editAgent.id);
        if (updateErr) throw updateErr;

        await supabase.from('ai_agent_pipeline_steps').delete().eq('agent_id', editAgent.id);

        if (hasPipeline) {
          const validSteps = steps.filter((s) => s.step_name.trim() && s.prompt_text.trim());
          if (validSteps.length > 0) {
            const rows = validSteps.map((s, i) => ({
              agent_id: editAgent.id,
              step_order: i,
              step_name: s.step_name.trim(),
              prompt_text: s.prompt_text.trim(),
            }));
            const { error: stepsErr } = await supabase.from('ai_agent_pipeline_steps').insert(rows);
            if (stepsErr) throw stepsErr;
          }
        }
      } else {
        const { data, error: insertErr } = await supabase
          .from('ai_custom_agents')
          .insert({
            user_id: userId,
            name: name.trim(),
            description: description.trim(),
            system_prompt: systemPrompt.trim(),
            model: model || null,
          })
          .select('id')
          .single();
        if (insertErr) throw insertErr;

        if (hasPipeline) {
          const validSteps = steps.filter((s) => s.step_name.trim() && s.prompt_text.trim());
          if (validSteps.length > 0) {
            const rows = validSteps.map((s, i) => ({
              agent_id: data.id,
              step_order: i,
              step_name: s.step_name.trim(),
              prompt_text: s.prompt_text.trim(),
            }));
            const { error: stepsErr } = await supabase.from('ai_agent_pipeline_steps').insert(rows);
            if (stepsErr) throw stepsErr;
          }
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udalo sie zapisac');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden border border-slate-200 dark:border-slate-700/50 flex flex-col">
        <div className="px-5 py-3 bg-gradient-to-r from-teal-600 to-emerald-600 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-white" />
            <h3 className="font-semibold text-white text-sm">
              {editAgent ? 'Edytuj agenta' : 'Nowy agent AI'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded transition-colors">
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-300 text-xs">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                Nazwa agenta
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
                placeholder="np. Analityk faktur"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                Model AI
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
              Opis (opcjonalny)
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
              placeholder="Krotki opis czym zajmuje sie agent..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
              Prompt systemowy
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm resize-none"
              placeholder="Instrukcje dla agenta - np. 'Jestes ekspertem od analizy faktur. Odpowiadaj zwieale po polsku...'"
            />
            <p className="mt-1 text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
              Definiuje zachowanie i role agenta. Agent bedzie mial dostep do danych faktur i umow z systemu.
            </p>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600" />
                <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
                  Pipeline (opcjonalny)
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  {hasPipeline ? 'Wlaczony' : 'Wylaczony'}
                </span>
                <button
                  onClick={() => {
                    setHasPipeline(!hasPipeline);
                    if (!hasPipeline && steps.length === 0) addStep();
                  }}
                  className={`relative w-9 h-5 rounded-full transition-colors ${hasPipeline ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${hasPipeline ? 'translate-x-4' : ''}`} />
                </button>
              </label>
            </div>

            {hasPipeline && (
              <div className="space-y-2">
                <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  Pipeline wykonuje kroki sekwencyjnie. Wynik kazdego kroku jest kontekstem dla nastepnego.
                </p>

                {steps.map((step, idx) => (
                  <div key={idx} className="border border-slate-200 dark:border-slate-700/50 rounded-lg p-2.5 bg-slate-50 dark:bg-dark-surface-variant">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <GripVertical className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0" />
                      <span className="text-xs font-bold text-teal-600 w-4 text-center flex-shrink-0">
                        {idx + 1}
                      </span>
                      <input
                        value={step.step_name}
                        onChange={(e) => updateStep(idx, 'step_name', e.target.value)}
                        className="flex-1 px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded text-xs bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-1 focus:ring-teal-500"
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
                          className="p-0.5 hover:bg-red-50 dark:hover:bg-red-900/10 rounded transition-colors"
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={step.prompt_text}
                      onChange={(e) => updateStep(idx, 'prompt_text', e.target.value)}
                      rows={2}
                      className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded text-xs bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark resize-none focus:ring-1 focus:ring-teal-500"
                      placeholder="Tresc prompta dla tego kroku..."
                    />
                  </div>
                ))}

                <button
                  onClick={addStep}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/10 rounded-lg transition-colors font-medium border border-dashed border-teal-300 dark:border-teal-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Dodaj krok
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700/50 flex gap-2 flex-shrink-0 bg-slate-50 dark:bg-dark-surface-variant">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 text-sm shadow-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Zapisywanie...' : editAgent ? 'Zapisz zmiany' : 'Stwórz agenta'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 text-text-secondary-light dark:text-text-secondary-dark font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors text-sm"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
