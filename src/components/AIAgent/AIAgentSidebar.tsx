import { useState } from 'react';
import { MessageSquare, Plus, Bot, Trash2, Clock, Search, ChevronDown, ChevronRight, Pencil, Check, X } from 'lucide-react';

export interface Conversation {
  id: string;
  title: string;
  agent_id: string | null;
  model: string;
  updated_at: string;
  created_at: string;
}

export interface CustomAgent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string | null;
  is_active: boolean;
  created_at: string;
  steps?: { step_name: string; prompt_text: string }[];
}

interface AIAgentSidebarProps {
  conversations: Conversation[];
  agents: CustomAgent[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onCreateAgent: () => void;
  onSelectAgent: (agent: CustomAgent) => void;
  onEditAgent: (agent: CustomAgent) => void;
  onDeleteAgent: (id: string) => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Teraz';
  if (diffMins < 60) return `${diffMins} min temu`;
  if (diffHours < 24) return `${diffHours}h temu`;
  if (diffDays < 7) return `${diffDays}d temu`;
  return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

export default function AIAgentSidebar({
  conversations,
  agents,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  onCreateAgent,
  onSelectAgent,
  onEditAgent,
  onDeleteAgent,
}: AIAgentSidebarProps) {
  const [search, setSearch] = useState('');
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const filteredAgents = agents.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const startRename = (conv: Conversation) => {
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  };

  const confirmRename = () => {
    if (renamingId && renameValue.trim()) {
      onRenameConversation(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div className="w-72 h-full flex flex-col bg-light-surface dark:bg-dark-surface border-r border-slate-200 dark:border-slate-700/50">
      <div className="p-3 border-b border-slate-200 dark:border-slate-700/50 space-y-2">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white rounded-lg font-medium text-sm transition-all shadow-sm hover:shadow-md"
        >
          <Plus className="w-4 h-4" />
          Nowa rozmowa
        </button>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700/50 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-2">
          <button
            onClick={() => setAgentsExpanded(!agentsExpanded)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
          >
            {agentsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Moi agenci ({filteredAgents.length})
          </button>

          {agentsExpanded && (
            <div className="space-y-0.5 mt-1">
              <button
                onClick={onCreateAgent}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/10 rounded-lg transition-colors font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Stwórz agenta
              </button>

              {filteredAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-surface-variant transition-colors cursor-pointer"
                >
                  <div
                    className="flex-1 flex items-center gap-2 min-w-0"
                    onClick={() => onSelectAgent(agent)}
                  >
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                        {agent.name}
                      </p>
                      {agent.description && (
                        <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark truncate">
                          {agent.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditAgent(agent); }}
                      className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
                    >
                      <Pencil className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteAgent(agent.id); }}
                      className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition-colors"
                    >
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-2 pt-0">
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
          >
            {historyExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Historia ({filteredConversations.length})
          </button>

          {historyExpanded && (
            <div className="space-y-0.5 mt-1">
              {filteredConversations.length === 0 && (
                <p className="px-3 py-4 text-xs text-text-secondary-light dark:text-text-secondary-dark text-center">
                  Brak rozmów
                </p>
              )}
              {filteredConversations.map((conv) => {
                const isActive = conv.id === activeConversationId;
                const isRenaming = conv.id === renamingId;

                return (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800/40'
                        : 'hover:bg-slate-100 dark:hover:bg-dark-surface-variant'
                    }`}
                  >
                    <div
                      className="flex-1 flex items-center gap-2 min-w-0"
                      onClick={() => !isRenaming && onSelectConversation(conv.id)}
                    >
                      <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-teal-600 dark:text-teal-400' : 'text-text-secondary-light dark:text-text-secondary-dark'}`} />
                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <div className="flex items-center gap-1">
                            <input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenamingId(null); }}
                              className="w-full px-1 py-0.5 text-xs border border-teal-300 rounded bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:outline-none"
                              autoFocus
                            />
                            <button onClick={confirmRename} className="p-0.5">
                              <Check className="w-3 h-3 text-teal-600" />
                            </button>
                            <button onClick={() => setRenamingId(null)} className="p-0.5">
                              <X className="w-3 h-3 text-red-500" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <p className={`text-xs font-medium truncate ${isActive ? 'text-teal-700 dark:text-teal-300' : 'text-text-primary-light dark:text-text-primary-dark'}`}>
                              {conv.title || 'Nowa rozmowa'}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-2.5 h-2.5 text-text-secondary-light dark:text-text-secondary-dark" />
                              <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                                {formatDate(conv.updated_at)}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {!isRenaming && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); startRename(conv); }}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
                        >
                          <Pencil className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition-colors"
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
