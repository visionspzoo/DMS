import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Send, Loader, Save, ChevronDown, Trash2, Plus, Search, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

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

interface ContractAIAssistantProps {
  contractId: string;
  contractTitle: string;
  pdfBase64: string | null;
}

const WELCOME_MESSAGE = 'Jestem asystentem AI do analizy umow. Wybierz prompt analizy lub wpisz wlasny, a nastepnie kliknij "Analizuj" aby rozpoczac.';

export function ContractAIAssistant({ contractId, contractTitle, pdfBase64 }: ContractAIAssistantProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [analyzed, setAnalyzed] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [promptName, setPromptName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
        const restored: Message[] = data.map(row => ({
          role: row.role as 'user' | 'assistant',
          content: row.content,
          timestamp: new Date(row.created_at),
        }));
        setMessages(restored);
        setAnalyzed(true);
      } else {
        setMessages([{
          role: 'assistant',
          content: WELCOME_MESSAGE,
          timestamp: new Date(),
        }]);
        setAnalyzed(false);
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
      setMessages([{
        role: 'assistant',
        content: WELCOME_MESSAGE,
        timestamp: new Date(),
      }]);
    } finally {
      setLoadingHistory(false);
    }
  }, [contractId, user]);

  useEffect(() => {
    loadChatHistory();
    loadSavedPrompts();
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

  const persistMessages = async (newMessages: Array<{ role: string; content: string }>) => {
    if (!user) return;
    try {
      const rows = newMessages.map(m => ({
        contract_id: contractId,
        user_id: user.id,
        role: m.role,
        content: m.content,
      }));
      const { error } = await supabase
        .from('contract_chat_messages')
        .insert(rows);
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
      setMessages([{
        role: 'assistant',
        content: WELCOME_MESSAGE,
        timestamp: new Date(),
      }]);
      setAnalyzed(false);
    } catch (error) {
      console.error('Error clearing chat history:', error);
    }
  };

  const loadSavedPrompts = async () => {
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
  };

  const handleSavePrompt = async () => {
    if (!user || !promptName.trim() || !customPrompt.trim()) return;
    try {
      setSavingPrompt(true);
      const { error } = await supabase
        .from('contract_ai_prompts')
        .insert({
          user_id: user.id,
          name: promptName.trim(),
          prompt_text: customPrompt.trim(),
        });
      if (error) throw error;
      setPromptName('');
      setShowSaveForm(false);
      await loadSavedPrompts();
    } catch (error) {
      console.error('Error saving prompt:', error);
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleDeletePrompt = async (promptId: string) => {
    try {
      const { error } = await supabase
        .from('contract_ai_prompts')
        .delete()
        .eq('id', promptId);
      if (error) throw error;
      if (selectedPromptId === promptId) {
        setSelectedPromptId('');
        setCustomPrompt('');
      }
      await loadSavedPrompts();
    } catch (error) {
      console.error('Error deleting prompt:', error);
    }
  };

  const handleSelectPrompt = (prompt: SavedPrompt) => {
    setSelectedPromptId(prompt.id);
    setCustomPrompt(prompt.prompt_text);
    setShowPromptDropdown(false);
  };

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
      setMessages(prev => [...prev, {
        role: 'system',
        content: 'Analizuje umowe...',
        timestamp: new Date()
      }]);

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
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const persistedHistory = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(({ role, content }) => ({ role, content }));

      const data = await callAI(
        'chat',
        userMessage.content,
        persistedHistory.slice(-10),
        true,
      );

      const aiContent = data.response || 'Przepraszam, nie moglem wygenerowac odpowiedzi.';
      const assistantMsg: Message = {
        role: 'assistant',
        content: aiContent,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMsg]);
      await persistMessages([
        { role: 'user', content: userMessage.content },
        { role: 'assistant', content: aiContent },
      ]);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Przepraszam, wystapil blad. Sprobuj ponownie.',
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const selectedPrompt = savedPrompts.find(p => p.id === selectedPromptId);

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
            <label className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark uppercase tracking-wide">
              Prompt analizy
            </label>

            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowPromptDropdown(!showPromptDropdown)}
                className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg bg-light-surface dark:bg-dark-surface text-sm text-left hover:border-brand-primary transition-colors"
              >
                <span className={`truncate ${selectedPrompt ? 'text-text-primary-light dark:text-text-primary-dark' : 'text-text-secondary-light dark:text-text-secondary-dark'}`}>
                  {selectedPrompt ? selectedPrompt.name : 'Wybierz zapisany prompt...'}
                </span>
                <ChevronDown className={`w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0 transition-transform ${showPromptDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showPromptDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  <button
                    onClick={() => {
                      setSelectedPromptId('');
                      setCustomPrompt('');
                      setShowPromptDropdown(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3" />
                    Wlasny prompt
                  </button>
                  {savedPrompts.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      Brak zapisanych promptow
                    </div>
                  ) : (
                    savedPrompts.map((prompt) => (
                      <div
                        key={prompt.id}
                        className={`flex items-center justify-between px-3 py-2 hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant ${
                          selectedPromptId === prompt.id ? 'bg-blue-50 dark:bg-blue-900/10' : ''
                        }`}
                      >
                        <button
                          onClick={() => handleSelectPrompt(prompt)}
                          className="flex-1 text-left text-sm text-text-primary-light dark:text-text-primary-dark truncate"
                        >
                          {prompt.name}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePrompt(prompt.id);
                          }}
                          className="p-1 hover:bg-red-50 dark:hover:bg-red-900/10 rounded text-red-500 flex-shrink-0 ml-2"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <textarea
              value={customPrompt}
              onChange={(e) => {
                setCustomPrompt(e.target.value);
                setSelectedPromptId('');
              }}
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark text-sm resize-none"
              placeholder="Wpisz wlasny prompt analizy lub wybierz z listy powyzej..."
            />

            {customPrompt.trim() && !selectedPromptId && (
              <div>
                {showSaveForm ? (
                  <div className="flex gap-2">
                    <input
                      value={promptName}
                      onChange={(e) => setPromptName(e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark text-xs"
                      placeholder="Nazwa prompta..."
                    />
                    <button
                      onClick={handleSavePrompt}
                      disabled={savingPrompt || !promptName.trim()}
                      className="px-3 py-1.5 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition-colors disabled:opacity-50 text-xs font-medium"
                    >
                      {savingPrompt ? '...' : 'Zapisz'}
                    </button>
                    <button
                      onClick={() => { setShowSaveForm(false); setPromptName(''); }}
                      className="px-2 py-1.5 text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant rounded-lg transition-colors text-xs"
                    >
                      Anuluj
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSaveForm(true)}
                    className="flex items-center gap-1.5 text-xs text-brand-primary hover:text-brand-primary-hover transition-colors"
                  >
                    <Save className="w-3 h-3" />
                    Zapisz prompt na pozniej
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            onClick={analyzeContract}
            disabled={loading || !pdfBase64}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-primary text-white hover:bg-brand-primary-hover rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
          >
            <Search className="w-4 h-4" />
            {loading ? 'Analizuje...' : 'Analizuj umowe'}
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
    </div>
  );
}
