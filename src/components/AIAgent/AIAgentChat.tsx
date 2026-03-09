import { useState, useRef, useEffect } from 'react';
import { Send, Brain, User, Loader2, Bot, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ModelSelector, type LLMModel } from './ModelSelector';
import type { CustomAgent } from './AIAgentSidebar';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  model?: string;
}

interface PipelineProgress {
  currentStep: number;
  totalSteps: number;
  stepName: string;
}

interface AIAgentChatProps {
  conversationId: string | null;
  activeAgent: CustomAgent | null;
  userId: string;
  onConversationCreated: (id: string, title: string) => void;
  onTitleUpdate: (id: string, title: string) => void;
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Witaj! Jestem AurusAI - asystentem do zarzadzania dokumentami. Korzystam z AI i uczenia maszynowego.\n\nMoge pomoc z:\n\n- Faktury - statusy, kwoty, terminy, dostawcy\n- Umowy - statusy, zatwierdzenia, streszczenia, dzialy\n- Dane ML - wzorce tagowania, predykcje, trafnosc sugestii\n- Statystyki - trendy, dzialy, raporty\n\nWybierz model AI w prawym gornym rogu. Jak moge Ci pomoc?',
  timestamp: new Date(),
};

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4': 'Claude Sonnet 4',
  'gpt-4o': 'GPT-4o',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
};

const quickQuestions = [
  'Ile mam faktur do akceptacji?',
  'Jaka jest suma faktur w tym miesiacu?',
  'Ile umow oczekuje na zatwierdzenie?',
  'Pokaz status wszystkich umow',
  'Jakie wzorce tagowania wykryl ML?',
  'Ktore faktury oczekuja na platnosc?',
];

export default function AIAgentChat({
  conversationId,
  activeAgent,
  userId,
  onConversationCreated,
  onTitleUpdate,
}: AIAgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<LLMModel>('claude-sonnet-4');
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentConvRef = useRef<string | null>(null);

  useEffect(() => {
    loadPreferredModel();
  }, [userId]);

  useEffect(() => {
    if (conversationId && conversationId !== currentConvRef.current) {
      currentConvRef.current = conversationId;
      loadConversationMessages(conversationId);
    } else if (!conversationId) {
      currentConvRef.current = null;
      setMessages([buildWelcomeMessage()]);
    }
  }, [conversationId]);

  useEffect(() => {
    if (activeAgent?.model) {
      setSelectedModel(activeAgent.model as LLMModel);
    }
  }, [activeAgent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function buildWelcomeMessage(): Message {
    if (activeAgent) {
      return {
        id: 'welcome',
        role: 'assistant',
        content: `Cześć! Jestem "${activeAgent.name}"${activeAgent.description ? ` - ${activeAgent.description}` : ''}.\n\n${activeAgent.steps && activeAgent.steps.length > 0 ? `Mam przygotowany pipeline z ${activeAgent.steps.length} ${activeAgent.steps.length === 1 ? 'krokiem' : 'krokami'}:\n${activeAgent.steps.map((s, i) => `${i + 1}. ${s.step_name}`).join('\n')}\n\nWpisz wiadomosc, aby uruchomic pipeline lub zadaj pytanie.` : 'Jak moge Ci pomoc?'}`,
        timestamp: new Date(),
      };
    }
    return WELCOME_MESSAGE;
  }

  const loadPreferredModel = async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('preferred_llm_model')
        .eq('id', userId)
        .maybeSingle();
      if (data?.preferred_llm_model) {
        setSelectedModel(data.preferred_llm_model as LLMModel);
      }
    } catch (err) {
      console.error('Error loading preferred model:', err);
    }
  };

  const loadConversationMessages = async (convId: string) => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('ai_conversation_messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setMessages(
          data.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: new Date(m.created_at),
            model: m.model || undefined,
          }))
        );
      } else {
        setMessages([buildWelcomeMessage()]);
      }
    } catch (err) {
      console.error('Error loading conversation:', err);
      setMessages([buildWelcomeMessage()]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const ensureConversation = async (): Promise<string> => {
    if (conversationId) return conversationId;

    const title = input.trim().slice(0, 60) || 'Nowa rozmowa';
    const { data, error } = await supabase
      .from('ai_conversations')
      .insert({
        user_id: userId,
        title,
        agent_id: activeAgent?.id || null,
        model: selectedModel,
      })
      .select('id')
      .single();

    if (error) throw error;
    onConversationCreated(data.id, title);
    currentConvRef.current = data.id;
    return data.id;
  };

  const saveMessage = async (convId: string, role: 'user' | 'assistant', content: string, model?: string) => {
    await supabase.from('ai_conversation_messages').insert({
      conversation_id: convId,
      role,
      content,
      model: model || null,
    });
  };

  const callAIAgent = async (message: string, history: { role: string; content: string }[]): Promise<{ response: string; model: string }> => {
    const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !session) throw new Error('Not authenticated');

    const body: Record<string, any> = {
      message,
      conversationHistory: history.slice(-10),
      model: selectedModel,
    };

    if (activeAgent?.system_prompt) {
      body.customSystemPrompt = activeAgent.system_prompt;
    }

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get AI response');
    }

    const data = await response.json();
    return { response: data.response, model: data.model };
  };

  const runPipeline = async (userMessage: string, convId: string, history: { role: string; content: string }[]) => {
    if (!activeAgent?.steps || activeAgent.steps.length === 0) return null;

    const results: string[] = [];

    for (let i = 0; i < activeAgent.steps.length; i++) {
      const step = activeAgent.steps[i];
      setPipelineProgress({ currentStep: i + 1, totalSteps: activeAgent.steps.length, stepName: step.step_name });

      const prompt = `${step.prompt_text}\n\nKontekst od uzytkownika: ${userMessage}${results.length > 0 ? `\n\nWyniki poprzednich krokow:\n${results.map((r, j) => `[Krok ${j + 1}]: ${r}`).join('\n\n')}` : ''}`;

      const extendedHistory = [...history, ...results.map((r, j) => ({ role: 'assistant' as const, content: `[${activeAgent.steps![j].step_name}]: ${r}` }))];

      const { response } = await callAIAgent(prompt, extendedHistory);
      results.push(response);
    }

    setPipelineProgress(null);

    const combinedResponse = activeAgent.steps
      .map((step, i) => `### ${step.step_name}\n\n${results[i]}`)
      .join('\n\n---\n\n');

    return combinedResponse;
  };

  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const messageText = input;
    setInput('');
    setLoading(true);

    try {
      const convId = await ensureConversation();
      await saveMessage(convId, 'user', messageText);

      const history = messages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role, content: m.content }));

      let responseText: string;
      let responseModel: string = selectedModel;

      if (activeAgent?.steps && activeAgent.steps.length > 0) {
        const pipelineResult = await runPipeline(messageText, convId, history);
        responseText = pipelineResult || 'Nie udalo sie wykonac pipeline.';
      } else {
        const result = await callAIAgent(messageText, history);
        responseText = result.response;
        responseModel = result.model;
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        model: responseModel,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      await saveMessage(convId, 'assistant', responseText, responseModel);

      if (messages.filter((m) => m.id !== 'welcome').length === 0) {
        const newTitle = messageText.slice(0, 60);
        onTitleUpdate(convId, newTitle);
      }

      await supabase
        .from('ai_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', convId);
    } catch (error: any) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Przepraszam, wystapil blad: ${error.message}. Sprobuj ponownie pozniej.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      setPipelineProgress(null);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (loadingHistory) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-teal-600 mx-auto" />
          <p className="mt-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Ladowanie rozmowy...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between bg-light-surface dark:bg-dark-surface">
        <div className="flex items-center gap-2 min-w-0">
          {activeAgent ? (
            <>
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
                <Bot className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark truncate">
                  {activeAgent.name}
                </h2>
                {activeAgent.description && (
                  <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark truncate">
                    {activeAgent.description}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
                <Brain className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                  AurusAI
                </h2>
                <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  Asystent AI do zarzadzania dokumentami
                </p>
              </div>
            </>
          )}
        </div>
        <ModelSelector selectedModel={selectedModel} onModelChange={setSelectedModel} compact />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                message.role === 'user'
                  ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                  : 'bg-gradient-to-br from-teal-500 to-emerald-600'
              }`}
            >
              {message.role === 'user' ? (
                <User className="w-4 h-4 text-white" />
              ) : (
                <Brain className="w-4 h-4 text-white" />
              )}
            </div>
            <div className={`flex-1 max-w-3xl ${message.role === 'user' ? 'text-right' : 'text-left'}`}>
              <div
                className={`inline-block px-4 py-3 rounded-2xl ${
                  message.role === 'user'
                    ? 'bg-gradient-to-br from-blue-500 to-cyan-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-text-primary-light dark:text-text-primary-dark'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              </div>
              <div className={`flex items-center gap-2 mt-1 px-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  {message.timestamp.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                </p>
                {message.model && message.role === 'assistant' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-text-secondary-light dark:text-text-secondary-dark">
                    {MODEL_LABELS[message.model] || message.model}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <div className="inline-block px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800">
                {pipelineProgress ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-teal-600 animate-pulse" />
                      <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
                        Krok {pipelineProgress.currentStep}/{pipelineProgress.totalSteps}: {pipelineProgress.stepName}
                      </span>
                    </div>
                    <div className="w-48 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${(pipelineProgress.currentStep / pipelineProgress.totalSteps) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
                )}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {messages.length <= 1 && !activeAgent && (
        <div className="px-4 pb-3">
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-2">
            Szybkie pytania:
          </p>
          <div className="flex flex-wrap gap-2">
            {quickQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => setInput(q)}
                className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-text-primary-light dark:text-text-primary-dark rounded-full transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-slate-200 dark:border-slate-700/50 p-3 bg-light-surface dark:bg-dark-surface">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={activeAgent ? `Wiadomosc do ${activeAgent.name}...` : 'Zadaj pytanie o faktury lub umowy...'}
            disabled={loading}
            className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          />
          <button
            onClick={handleSendMessage}
            disabled={!input.trim() || loading}
            className="px-5 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md hover:shadow-lg text-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
