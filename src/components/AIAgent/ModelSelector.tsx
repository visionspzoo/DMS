import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Star, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

export type LLMModel = 'claude-sonnet-4' | 'gpt-4o' | 'gemini-2.0-flash';

interface ModelOption {
  id: LLMModel;
  label: string;
  provider: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const ALL_MODELS: ModelOption[] = [
  {
    id: 'claude-sonnet-4',
    label: 'Claude Sonnet 4',
    provider: 'Anthropic',
    color: 'text-orange-700 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    borderColor: 'border-orange-200 dark:border-orange-800/40',
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    provider: 'OpenAI',
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderColor: 'border-emerald-200 dark:border-emerald-800/40',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    provider: 'Google',
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800/40',
  },
];

interface ModelSelectorProps {
  selectedModel: LLMModel;
  onModelChange: (model: LLMModel) => void;
  compact?: boolean;
}

export function ModelSelector({ selectedModel, onModelChange, compact = false }: ModelSelectorProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<LLMModel[]>([]);
  const [defaultModel, setDefaultModel] = useState<LLMModel | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAvailableModels();
    loadDefaultModel();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadAvailableModels = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent`,
        {
          method: 'GET',
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setAvailableModels(data.models.map((m: { id: LLMModel }) => m.id));
      }
    } catch (error) {
      console.error('Error loading available models:', error);
      setAvailableModels(['claude-sonnet-4']);
    }
  };

  const loadDefaultModel = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('preferred_llm_model')
        .eq('id', user.id)
        .maybeSingle();

      if (data?.preferred_llm_model) {
        setDefaultModel(data.preferred_llm_model as LLMModel);
      }
    } catch (error) {
      console.error('Error loading default model:', error);
    }
  };

  const handleSetDefault = async (model: LLMModel) => {
    if (!user) return;
    setSavingDefault(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ preferred_llm_model: model })
        .eq('id', user.id);

      if (error) throw error;
      setDefaultModel(model);
    } catch (error) {
      console.error('Error saving default model:', error);
    } finally {
      setSavingDefault(false);
    }
  };

  const currentModel = ALL_MODELS.find(m => m.id === selectedModel) || ALL_MODELS[0];
  const displayModels = ALL_MODELS.filter(m => availableModels.includes(m.id));

  if (displayModels.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-xs font-medium ${currentModel.bgColor} ${currentModel.borderColor} ${currentModel.color} hover:opacity-90`}
      >
        <span className={compact ? 'hidden sm:inline' : ''}>{currentModel.label}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700/30">
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark">
              Wybierz model AI
            </p>
          </div>

          <div className="py-1">
            {displayModels.map((model) => {
              const isSelected = model.id === selectedModel;
              const isDefault = model.id === defaultModel;

              return (
                <div
                  key={model.id}
                  className={`flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors ${
                    isSelected
                      ? `${model.bgColor}`
                      : 'hover:bg-slate-50 dark:hover:bg-dark-surface-variant'
                  }`}
                >
                  <button
                    onClick={() => {
                      onModelChange(model.id);
                      setOpen(false);
                    }}
                    className="flex-1 flex items-center gap-2.5 text-left"
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${model.bgColor} border ${model.borderColor}`}>
                      {isSelected && <Check className={`w-3.5 h-3.5 ${model.color}`} />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${isSelected ? model.color : 'text-text-primary-light dark:text-text-primary-dark'}`}>
                        {model.label}
                      </p>
                      <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                        {model.provider}
                      </p>
                    </div>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetDefault(model.id);
                    }}
                    disabled={savingDefault}
                    className={`p-1.5 rounded-lg transition-colors ${
                      isDefault
                        ? 'text-amber-500'
                        : 'text-slate-300 dark:text-slate-600 hover:text-amber-400'
                    }`}
                    title={isDefault ? 'Model domyslny' : 'Ustaw jako domyslny'}
                  >
                    {savingDefault ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Star className={`w-3.5 h-3.5 ${isDefault ? 'fill-current' : ''}`} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-700/30 bg-slate-50 dark:bg-dark-surface-variant">
            <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
              Kliknij gwiazdke aby ustawic model domyslny
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
