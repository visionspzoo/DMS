import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import AIAgentSidebar, { type Conversation, type CustomAgent } from './AIAgentSidebar';
import AIAgentChat from './AIAgentChat';
import AIAgentCreator from './AIAgentCreator';

export default function AIAgent() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<CustomAgent | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [editingAgent, setEditingAgent] = useState<CustomAgent | null>(null);
  const [chatKey, setChatKey] = useState(0);

  useEffect(() => {
    if (user) {
      loadConversations();
      loadAgents();
    }
  }, [user]);

  const loadConversations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    setConversations(data || []);
  };

  const loadAgents = async () => {
    if (!user) return;
    const { data: agentsData } = await supabase
      .from('ai_custom_agents')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (agentsData && agentsData.length > 0) {
      const agentIds = agentsData.map((a) => a.id);
      const { data: stepsData } = await supabase
        .from('ai_agent_pipeline_steps')
        .select('*')
        .in('agent_id', agentIds)
        .order('step_order', { ascending: true });

      const stepsMap = new Map<string, { step_name: string; prompt_text: string }[]>();
      (stepsData || []).forEach((s) => {
        if (!stepsMap.has(s.agent_id)) stepsMap.set(s.agent_id, []);
        stepsMap.get(s.agent_id)!.push({ step_name: s.step_name, prompt_text: s.prompt_text });
      });

      setAgents(
        agentsData.map((a) => ({
          ...a,
          steps: stepsMap.get(a.id) || [],
        }))
      );
    } else {
      setAgents([]);
    }
  };

  const handleNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setActiveAgent(null);
    setChatKey((k) => k + 1);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (conv?.agent_id) {
      const agent = agents.find((a) => a.id === conv.agent_id);
      setActiveAgent(agent || null);
    } else {
      setActiveAgent(null);
    }
    setActiveConversationId(id);
    setChatKey((k) => k + 1);
  }, [conversations, agents]);

  const handleDeleteConversation = async (id: string) => {
    await supabase.from('ai_conversations').delete().eq('id', id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setChatKey((k) => k + 1);
    }
  };

  const handleRenameConversation = async (id: string, title: string) => {
    await supabase.from('ai_conversations').update({ title }).eq('id', id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  };

  const handleSelectAgent = useCallback((agent: CustomAgent) => {
    setActiveAgent(agent);
    setActiveConversationId(null);
    setChatKey((k) => k + 1);
  }, []);

  const handleEditAgent = (agent: CustomAgent) => {
    setEditingAgent(agent);
    setShowCreator(true);
  };

  const handleDeleteAgent = async (id: string) => {
    await supabase.from('ai_custom_agents').update({ is_active: false }).eq('id', id);
    setAgents((prev) => prev.filter((a) => a.id !== id));
    if (activeAgent?.id === id) {
      setActiveAgent(null);
      setChatKey((k) => k + 1);
    }
  };

  const handleConversationCreated = (id: string, title: string) => {
    const newConv: Conversation = {
      id,
      title,
      agent_id: activeAgent?.id || null,
      model: 'claude-sonnet-4',
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(id);
  };

  const handleTitleUpdate = (id: string, title: string) => {
    handleRenameConversation(id, title);
  };

  if (!user) return null;

  return (
    <div className="h-full flex flex-col bg-light-bg dark:bg-dark-bg">
      <div className="flex-shrink-0 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/50 px-4 py-2.5 flex items-center gap-2.5">
        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">!</span>
        </div>
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
          W budowie &mdash; brak pełnej funkcjonalności
        </p>
      </div>
      <div className="flex-1 flex overflow-hidden">
      <AIAgentSidebar
        conversations={conversations}
        agents={agents}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        onCreateAgent={() => { setEditingAgent(null); setShowCreator(true); }}
        onSelectAgent={handleSelectAgent}
        onEditAgent={handleEditAgent}
        onDeleteAgent={handleDeleteAgent}
      />

      <AIAgentChat
        key={chatKey}
        conversationId={activeConversationId}
        activeAgent={activeAgent}
        userId={user.id}
        onConversationCreated={handleConversationCreated}
        onTitleUpdate={handleTitleUpdate}
      />

      {showCreator && (
        <AIAgentCreator
          userId={user.id}
          editAgent={editingAgent}
          onClose={() => { setShowCreator(false); setEditingAgent(null); }}
          onSaved={loadAgents}
        />
      )}
      </div>
    </div>
  );
}
