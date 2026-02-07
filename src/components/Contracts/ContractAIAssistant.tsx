import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Send, Loader, Save, ChevronDown, Trash2, Plus, Search, RotateCcw, GitBranch } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import PromptPipelineCreator from './PromptPipelineCreator';
import { ModelSelector, type LLMModel } from '../AIAgent/ModelSelector';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface SavedPrompt {
  id: string;
  name: string;
  prompt_text: string;
  created_at: string;
}

interface AdminPrompt {
  id: string;
  name: string;
  prompt_text: string;
}

interface PipelineStep {
  step_order: number;
  step_name: string;
  prompt_text: string;
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  user_id: string | null;
  steps: PipelineStep[];
}

interface ContractAIAssistantProps {
  contractId: string;
  contractTitle: string;
  pdfBase64: string | null;
}

const WELCOME_MESSAGE = 'Jestem asystentem AI do analizy umow. Wybierz prompt analizy, pipeline lub wpisz wlasny, a nastepnie kliknij "Analizuj" aby rozpoczac.';

export function ContractAIAssistant({ contractId, contractTitle, pdfBase64 }: ContractAIAssistantProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [analyzed, setAnalyzed] = useState(false);
  const [progressText, setProgressText] = useState('');

  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [adminPrompts, setAdminPrompts] = useState<AdminPrompt[]>([]);
  const [systemPipelines, setSystemPipelines] = useState<Pipeline[]>([]);
  const [userPipelines, setUserPipelines] = useState<Pipeline[]>([]);

  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [selectedAdminPromptId, setSelectedAdminPromptId] = useState('');
  const [selectedPipelineId, setSelectedPipelineId] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');

  const [showPromptDropdown, setShowPromptDropdown] = useState(false);
  const [creatorMode, setCreatorMode] = useState<'prompt' | 'pipeline' | null>(null);
  const [selectedModel, setSelectedModel] = useState<LLMModel>('claude-sonnet-4');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allPipelines = [...systemPipelines, ...userPipelines];
  const selectedPipeline = allPipelines.find(p => p.id === selectedPipelineId);
  const selectedUserPrompt = savedPrompts.find(p => p.id === selectedPromptId);
  const selectedAdminPrompt = adminPrompts.find(p => p.id === selectedAdminPromptId);
  const isPipelineSelected = !!selectedPipelineId;

  const dropdownLabel = selectedPipeline
    ? `Pipeline: ${selectedPipeline.name}`
    : selectedAdminPrompt
    ? selectedAdminPrompt.name
    : selectedUserPrompt
    ? selectedUserPrompt.name
    : 'Wybierz prompt lub pipeline...';

  const hasSelection = !!(selectedPromptId || selectedAdminPromptId || selectedPipelineId);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('preferred_llm_model')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.preferred_llm_model) {
          setSelectedModel(data.preferred_llm_model as LLMModel);
        }
      });
  }, [user]);

  const loadChatHistory = useCallback(async () => {
    if (!user) return;
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('contract_chat_messages')
        .select('role, content, created_at')
        .eq('contract_id', contractId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (error) throw error;

      if (data && data.length > 0) {
        setMessages(data.map(row => ({
          role: row.role as 'user' | 'assistant',
          content: row.content,
          timestamp: new Date(row.created_at),
        })));
        setAnalyzed(true);
      } else {
        setMessages([{ role: 'assistant', content: WELCOME_MESSAGE, timestamp: new Date() }]);
        setAnalyzed(false);
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
      setMessages([{ role: 'assistant', content: WELCOME_MESSAGE, timestamp: new Date() }]);
    } finally {
      setLoadingHistory(false);
    }
  }, [contractId, user]);

  useEffect(() => {
    loadChatHistory();
    reloadAll();
  }, [loadChatHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowPromptDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function reloadAll() {
    loadSavedPrompts();
    loadAdminPrompts();
    loadPipelines();
  }

  async function loadSavedPrompts() {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('contract_ai_prompts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSavedPrompts(data || []);
    } catch (error) {
      console.error('Error loading saved prompts:', error);
    }
  }

  async function loadAdminPrompts() {
    try {
      const { data, error } = await supabase
        .from('contract_admin_prompts')
        .select('id, name, prompt_text')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setAdminPrompts(data || []);
    } catch (error) {
      console.error('Error loading admin prompts:', error);
    }
  }

  async function loadPipelines() {
    try {
      const { data, error } = await supabase
        .from('contract_pipelines')
        .select('id, name, description, user_id, steps:contract_pipeline_steps(step_order, step_name, prompt_text)')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const sorted = (data || []).map((p: any) => ({
        ...p,
        steps: (p.steps || []).sort((a: PipelineStep, b: PipelineStep) => a.step_order - b.step_order),
      }));

      setSystemPipelines(sorted.filter((p: Pipeline) => !p.user_id));
      setUserPipelines(sorted.filter((p: Pipeline) => p.user_id));
    } catch (error) {
      console.error('Error loading pipelines:', error);
    }
  }

  function clearSelection() {
    setSelectedPromptId('');
    setSelectedAdminPromptId('');
    setSelectedPipelineId('');
    setCustomPrompt('');
    setShowPromptDropdown(false);
  }

  function selectUserPrompt(prompt: SavedPrompt) {
    setSelectedPromptId(prompt.id);
    setSelectedAdminPromptId('');
    setSelectedPipelineId('');
    setCustomPrompt(prompt.prompt_text);
    setShowPromptDropdown(false);
  }

  function selectAdminPrompt(prompt: AdminPrompt) {
    setSelectedAdminPromptId(prompt.id);
    setSelectedPromptId('');
    setSelectedPipelineId('');
    setCustomPrompt(prompt.prompt_text);
    setShowPromptDropdown(false);
  }

  function selectPipeline(pipeline: Pipeline) {
    setSelectedPipelineId(pipeline.id);
    setSelectedPromptId('');
    setSelectedAdminPromptId('');
    setCustomPrompt('');
    setShowPromptDropdown(false);
  }

  const persistMessages = async (newMessages: Array<{ role: string; content: string }>) => {
    if (!user) return;
    try {
      const rows = newMessages.map(m => ({
        contract_id: contractId,
        user_id: user.id,
        role: m.role,
        content: m.content,
      }));
      const { error } = await supabase.from('contract_chat_messages').insert(rows);
      if (error) throw error;
    } catch (error) {
      console.error('Error persisting chat messages:', error);
    }
  };

  const clearHistory = async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('contract_chat_messages')
        .delete()
        .eq('contract_id', contractId)
        .eq('user_id', user.id);
      if (error) throw error;
      setMessages([{ role: 'assistant', content: WELCOME_MESSAGE, timestamp: new Date() }]);
      setAnalyzed(false);
    } catch (error) {
      console.error('Error clearing chat history:', error);
    }
  };

  async function handleDeletePrompt(promptId: string) {
    try {
      const { error } = await supabase.from('contract_ai_prompts').delete().eq('id', promptId);
      if (error) throw error;
      if (selectedPromptId === promptId) clearSelection();
      await loadSavedPrompts();
    } catch (error) {
      console.error('Error deleting prompt:', error);
    }
  }

  async function handleDeleteUserPipeline(pipelineId: string) {
    try {
      const { error } = await supabase.from('contract_pipelines').delete().eq('id', pipelineId);
      if (error) throw error;
      if (selectedPipelineId === pipelineId) clearSelection();
      await loadPipelines();
    } catch (error) {
      console.error('Error deleting pipeline:', error);
    }
  }

  const getSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Brak sesji');
    return session;
  };

  const callAI = async (
    action: string,
    prompt: string,
    chatHistory: Array<{ role: string; content: string }>,
    includePdf: boolean,
  ) => {
    const session = await getSession();
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action,
          contract_id: contractId,
          pdf_base64: includePdf ? (pdfBase64 || undefined) : undefined,
          prompt,
          chat_history: chatHistory,
          model: selectedModel,
        }),
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }
    return response.json();
  };

  const analyzeContract = async () => {
    if (!pdfBase64) return;

    const promptToUse = customPrompt.trim() || `Przeanalizuj umowe "${contractTitle}" i wypunktuj najwazniejsze informacje:\n- Strony umowy\n- Daty\n- Kwoty\n- Kluczowe zobowiazania\n- Terminy\n- Inne istotne klauzule`;

    setLoading(true);
    try {
      setMessages(prev => [...prev, { role: 'system', content: 'Analizuje umowe...', timestamp: new Date() }]);

      const data = await callAI('analyze_contract', promptToUse, [], true);

      const userMsg = { role: 'user', content: promptToUse };
      const aiContent = data.response || 'Analiza zakonczona';
      const assistantMsg = { role: 'assistant', content: aiContent };

      setMessages(prev => {
        const filtered = prev.filter(m => m.role !== 'system');
        return [
          ...filtered,
          { ...userMsg, timestamp: new Date() } as Message,
          { ...assistantMsg, timestamp: new Date() } as Message,
        ];
      });

      await persistMessages([userMsg, assistantMsg]);
      setAnalyzed(true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setMessages(prev => prev.filter(m => m.role !== 'system'));
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Wystapil blad podczas analizy: ${errorMessage}`,
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
      setProgressText('');
    }
  };

  const executePipeline = async () => {
    if (!pdfBase64 || !selectedPipeline || selectedPipeline.steps.length === 0) return;

    setLoading(true);
    try {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `Uruchamiam pipeline "${selectedPipeline.name}"...`,
        timestamp: new Date(),
      }]);

      const results: string[] = [];
      const previousContext: Array<{ role: string; content: string }> = [];
      const totalSteps = selectedPipeline.steps.length;

      for (let i = 0; i < totalSteps; i++) {
        const step = selectedPipeline.steps[i];
        const progress = `Krok ${i + 1}/${totalSteps}: ${step.step_name}...`;
        setProgressText(progress);

        setMessages(prev => {
          const filtered = prev.filter(m => m.role !== 'system');
          return [...filtered, { role: 'system', content: progress, timestamp: new Date() }];
        });

        const data = await callAI('analyze_contract', step.prompt_text, previousContext, true);

        const stepResult = data.response || '';
        results.push(`## ${step.step_name}\n\n${stepResult}`);

        previousContext.push(
          { role: 'user', content: step.prompt_text },
          { role: 'assistant', content: stepResult },
        );
      }

      const combinedResult = results.join('\n\n---\n\n');
      const userMsg = { role: 'user', content: `Pipeline: ${selectedPipeline.name}` };
      const assistantMsg = { role: 'assistant', content: combinedResult };

      setMessages(prev => {
        const filtered = prev.filter(m => m.role !== 'system');
        return [
          ...filtered,
          { ...userMsg, timestamp: new Date() } as Message,
          { ...assistantMsg, timestamp: new Date() } as Message,
        ];
      });

      await persistMessages([userMsg, assistantMsg]);
      setAnalyzed(true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setMessages(prev => prev.filter(m => m.role !== 'system'));
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Wystapil blad podczas pipeline: ${errorMessage}`,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      setProgressText('');
    }
  };

  const handleAnalyzeClick = () => {
    if (isPipelineSelected) executePipeline();
    else analyzeContract();
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: 'user', content: input.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const persistedHistory = messages
        .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content !== WELCOME_MESSAGE)
        .map(({ role, content }) => ({ role, content }));

      const data = await callAI('chat', userMessage.content, persistedHistory.slice(-10), true);

      const aiContent = data.response || 'Przepraszam, nie moglem wygenerowac odpowiedzi.';
      const assistantMsg: Message = { role: 'assistant', content: aiContent, timestamp: new Date() };

      setMessages(prev => [...prev, assistantMsg]);
      await persistMessages([
        { role: 'user', content: userMessage.content },
        { role: 'assistant', content: aiContent },
      ]);
    } catch (error) {
      console.error('Error sending message:', error);
      let detail = '';
      if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message);
          detail = parsed.error || parsed.message || error.message;
        } catch {
          detail = error.message;
        }
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Przepraszam, wystapil blad. Sprobuj ponownie.${detail ? ` (${detail})` : ''}`,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (loadingHistory) {
    return (
      <div className="h-full flex flex-col bg-light-surface dark:bg-dark-surface">
        <div className="bg-gradient-to-r from-brand-primary to-blue-700 px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-white">
            <Sparkles className="w-4 h-4" />
            <h3 className="font-semibold text-sm">Asystent AI</h3>
          </div>
          <p className="text-blue-100 text-xs mt-0.5">Analiza i pytania o umowe</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader className="w-5 h-5 animate-spin text-brand-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-light-surface dark:bg-dark-surface">
      <div className="bg-gradient-to-r from-brand-primary to-blue-700 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Sparkles className="w-4 h-4" />
            <h3 className="font-semibold text-sm">Asystent AI</h3>
            <ModelSelector
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              compact
            />
          </div>
          {analyzed && (
            <button
              onClick={clearHistory}
              className="flex items-center gap-1 px-2 py-1 text-xs text-blue-100 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="Wyczysc historie czatu"
            >
              <RotateCcw className="w-3 h-3" />
              Nowa analiza
            </button>
          )}
        </div>
        <p className="text-blue-100 text-xs mt-0.5">Analiza i pytania o umowe</p>
      </div>

      {!analyzed && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50 space-y-3 flex-shrink-0 bg-slate-50 dark:bg-dark-surface-variant">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark uppercase tracking-wide">
                Prompt / Pipeline
              </label>
              <div className="flex gap-1">
                <button
                  onClick={() => setCreatorMode('prompt')}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-brand-primary hover:bg-blue-50 dark:hover:bg-blue-900/10 rounded transition-colors font-medium"
                >
                  <Plus className="w-3 h-3" />
                  Prompt
                </button>
                <button
                  onClick={() => setCreatorMode('pipeline')}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/10 rounded transition-colors font-medium"
                >
                  <Plus className="w-3 h-3" />
                  Pipeline
                </button>
              </div>
            </div>

            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowPromptDropdown(!showPromptDropdown)}
                className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg bg-light-surface dark:bg-dark-surface text-sm text-left hover:border-brand-primary transition-colors"
              >
                <span className={`truncate flex items-center gap-1.5 ${hasSelection ? 'text-text-primary-light dark:text-text-primary-dark' : 'text-text-secondary-light dark:text-text-secondary-dark'}`}>
                  {isPipelineSelected && <GitBranch className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />}
                  {dropdownLabel}
                </span>
                <ChevronDown className={`w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0 transition-transform ${showPromptDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showPromptDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
                  <button
                    onClick={clearSelection}
                    className="w-full px-3 py-2 text-left text-sm text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3" />
                    Wlasny prompt
                  </button>

                  {adminPrompts.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark bg-slate-50 dark:bg-dark-surface-variant border-t border-slate-100 dark:border-slate-700/30">
                        Prompty systemowe
                      </div>
                      {adminPrompts.map(prompt => (
                        <button
                          key={prompt.id}
                          onClick={() => selectAdminPrompt(prompt)}
                          className={`w-full px-3 py-2 text-left text-sm text-text-primary-light dark:text-text-primary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant truncate ${
                            selectedAdminPromptId === prompt.id ? 'bg-blue-50 dark:bg-blue-900/10' : ''
                          }`}
                        >
                          {prompt.name}
                        </button>
                      ))}
                    </>
                  )}

                  {systemPipelines.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark bg-slate-50 dark:bg-dark-surface-variant border-t border-slate-100 dark:border-slate-700/30">
                        Pipeline systemowe
                      </div>
                      {systemPipelines.map(pipeline => (
                        <button
                          key={pipeline.id}
                          onClick={() => selectPipeline(pipeline)}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant flex items-center gap-2 ${
                            selectedPipelineId === pipeline.id ? 'bg-blue-50 dark:bg-blue-900/10' : ''
                          }`}
                        >
                          <GitBranch className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
                          <span className="truncate text-text-primary-light dark:text-text-primary-dark">{pipeline.name}</span>
                          <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0">
                            ({pipeline.steps.length} {pipeline.steps.length === 1 ? 'krok' : pipeline.steps.length < 5 ? 'kroki' : 'krokow'})
                          </span>
                        </button>
                      ))}
                    </>
                  )}

                  {savedPrompts.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark bg-slate-50 dark:bg-dark-surface-variant border-t border-slate-100 dark:border-slate-700/30">
                        Moje prompty
                      </div>
                      {savedPrompts.map(prompt => (
                        <div
                          key={prompt.id}
                          className={`flex items-center justify-between px-3 py-2 hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant ${
                            selectedPromptId === prompt.id ? 'bg-blue-50 dark:bg-blue-900/10' : ''
                          }`}
                        >
                          <button
                            onClick={() => selectUserPrompt(prompt)}
                            className="flex-1 text-left text-sm text-text-primary-light dark:text-text-primary-dark truncate"
                          >
                            {prompt.name}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeletePrompt(prompt.id); }}
                            className="p-1 hover:bg-red-50 dark:hover:bg-red-900/10 rounded text-red-500 flex-shrink-0 ml-2"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </>
                  )}

                  {userPipelines.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark bg-slate-50 dark:bg-dark-surface-variant border-t border-slate-100 dark:border-slate-700/30">
                        Moje pipeline
                      </div>
                      {userPipelines.map(pipeline => (
                        <div
                          key={pipeline.id}
                          className={`flex items-center justify-between px-3 py-2 hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant ${
                            selectedPipelineId === pipeline.id ? 'bg-blue-50 dark:bg-blue-900/10' : ''
                          }`}
                        >
                          <button
                            onClick={() => selectPipeline(pipeline)}
                            className="flex-1 text-left text-sm flex items-center gap-2 truncate"
                          >
                            <GitBranch className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
                            <span className="truncate text-text-primary-light dark:text-text-primary-dark">{pipeline.name}</span>
                            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0">
                              ({pipeline.steps.length})
                            </span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteUserPipeline(pipeline.id); }}
                            className="p-1 hover:bg-red-50 dark:hover:bg-red-900/10 rounded text-red-500 flex-shrink-0 ml-2"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {isPipelineSelected && selectedPipeline ? (
              <div className="bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg p-2.5 space-y-1.5">
                {selectedPipeline.description && (
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{selectedPipeline.description}</p>
                )}
                <div className="space-y-1">
                  {selectedPipeline.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-4 h-4 rounded-full bg-teal-100 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 font-bold flex items-center justify-center flex-shrink-0 text-[10px]">
                        {i + 1}
                      </span>
                      <span className="text-text-primary-light dark:text-text-primary-dark">{step.step_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <textarea
                value={customPrompt}
                onChange={(e) => {
                  setCustomPrompt(e.target.value);
                  setSelectedPromptId('');
                  setSelectedAdminPromptId('');
                }}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark text-sm resize-none"
                placeholder="Wpisz wlasny prompt analizy lub wybierz z listy powyzej..."
              />
            )}
          </div>

          <button
            onClick={handleAnalyzeClick}
            disabled={loading || !pdfBase64}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium ${
              isPipelineSelected
                ? 'bg-teal-600 hover:bg-teal-700'
                : 'bg-brand-primary hover:bg-brand-primary-hover'
            }`}
          >
            {isPipelineSelected ? <GitBranch className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            {loading
              ? (progressText || 'Analizuje...')
              : isPipelineSelected
              ? 'Uruchom pipeline'
              : 'Analizuj umowe'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((message, idx) => (
          <div
            key={idx}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[90%] rounded-lg px-3 py-2 ${
                message.role === 'user'
                  ? 'bg-brand-primary text-white'
                  : message.role === 'system'
                  ? 'bg-yellow-50 dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800/30'
                  : 'bg-slate-100 dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
              <p className={`text-xs mt-1 ${
                message.role === 'user' ? 'text-blue-100' : 'text-text-secondary-light dark:text-text-secondary-dark'
              }`}>
                {message.timestamp.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-dark-surface-variant rounded-lg px-3 py-2">
              <Loader className="w-4 h-4 animate-spin text-text-secondary-light dark:text-text-secondary-dark" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {analyzed && (
        <div className="p-3 bg-slate-50 dark:bg-dark-surface-variant border-t border-slate-200 dark:border-slate-700/50 flex-shrink-0">
          <div className="flex gap-1.5 flex-wrap mb-2">
            <button
              onClick={() => setInput('Jakie sa kluczowe terminy w umowie?')}
              className="px-2 py-1 bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 hover:border-brand-primary/30 rounded text-xs text-text-secondary-light dark:text-text-secondary-dark transition-colors"
            >
              Terminy
            </button>
            <button
              onClick={() => setInput('Jakie sa kwoty i platnosci?')}
              className="px-2 py-1 bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 hover:border-brand-primary/30 rounded text-xs text-text-secondary-light dark:text-text-secondary-dark transition-colors"
            >
              Platnosci
            </button>
            <button
              onClick={() => setInput('Kto jest strona umowy?')}
              className="px-2 py-1 bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 hover:border-brand-primary/30 rounded text-xs text-text-secondary-light dark:text-text-secondary-dark transition-colors"
            >
              Strony
            </button>
            <button
              onClick={() => setInput('Jakie sa ryzyka w tej umowie?')}
              className="px-2 py-1 bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 hover:border-brand-primary/30 rounded text-xs text-text-secondary-light dark:text-text-secondary-dark transition-colors"
            >
              Ryzyka
            </button>
          </div>
        </div>
      )}

      <div className="px-3 pb-3 pt-2 border-t border-slate-200 dark:border-slate-700/50 flex-shrink-0">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            rows={2}
            className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm resize-none"
            placeholder="Zadaj pytanie o umowe..."
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-3 bg-brand-primary text-white hover:bg-brand-primary-hover rounded-lg transition-colors disabled:opacity-50 self-end py-2"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {creatorMode && user && (
        <PromptPipelineCreator
          userId={user.id}
          initialMode={creatorMode}
          onClose={() => setCreatorMode(null)}
          onCreated={reloadAll}
        />
      )}
    </div>
  );
}
