import { useState, useEffect, useRef } from 'react';
import { Send, Trash2, MessageSquare, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface Comment {
  id: string;
  purchase_request_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author?: { full_name: string | null; email: string | null };
}

export function PurchaseRequestComments({ requestId }: { requestId: string }) {
  const { user, profile } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadComments();

    const channel = supabase
      .channel(`pr-comments-${requestId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'purchase_request_comments', filter: `purchase_request_id=eq.${requestId}` },
        (payload) => {
          const newRow = payload.new as Comment;
          if (newRow.user_id !== user?.id) {
            loadComments();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'purchase_request_comments', filter: `purchase_request_id=eq.${requestId}` },
        () => { loadComments(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [requestId]);

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [comments, loading]);

  async function loadComments() {
    const { data } = await supabase
      .from('purchase_request_comments')
      .select('*')
      .eq('purchase_request_id', requestId)
      .order('created_at', { ascending: true });

    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(c => c.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
      setComments(data.map(c => ({ ...c, author: profileMap[c.user_id] })));
    } else {
      setComments(data || []);
    }
    setLoading(false);
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);

    const tempId = `temp-${Date.now()}`;
    const optimisticComment: Comment = {
      id: tempId,
      purchase_request_id: requestId,
      user_id: user!.id,
      content: trimmed,
      created_at: new Date().toISOString(),
      author: { full_name: profile?.full_name || null, email: user?.email || null },
    };
    setComments(prev => [...prev, optimisticComment]);
    setText('');
    textareaRef.current?.focus();

    const { data, error } = await supabase
      .from('purchase_request_comments')
      .insert({
        purchase_request_id: requestId,
        user_id: user!.id,
        content: trimmed,
      })
      .select('*')
      .single();

    setSending(false);

    if (error) {
      setComments(prev => prev.filter(c => c.id !== tempId));
      setText(trimmed);
    } else if (data) {
      setComments(prev =>
        prev.map(c => c.id === tempId ? { ...data, author: optimisticComment.author } : c)
      );
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setComments(prev => prev.filter(c => c.id !== id));
    const { error } = await supabase.from('purchase_request_comments').delete().eq('id', id);
    if (error) {
      await loadComments();
    }
    setDeletingId(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }

  function getInitials(name: string | null | undefined, email: string | null | undefined) {
    if (name) {
      const parts = name.trim().split(' ');
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return name.slice(0, 2).toUpperCase();
    }
    return (email || '?').slice(0, 2).toUpperCase();
  }

  const avatarColors = [
    'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
    'bg-sky-500', 'bg-teal-500', 'bg-orange-500', 'bg-slate-500',
  ];

  function getAvatarColor(userId: string) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) % avatarColors.length;
    return avatarColors[Math.abs(hash) % avatarColors.length];
  }

  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
        <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
          Dyskusja
        </h3>
        {comments.length > 0 && (
          <span className="ml-auto text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {comments.length} {comments.length === 1 ? 'komentarz' : comments.length < 5 ? 'komentarze' : 'komentarzy'}
          </span>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-text-secondary-light dark:text-text-secondary-dark" />
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              Brak komentarzy. Rozpocznij dyskusję.
            </p>
          </div>
        ) : (
          comments.map((comment) => {
            const isOwn = comment.user_id === user?.id;
            const displayName = comment.author?.full_name || comment.author?.email || 'Nieznany';
            const initials = getInitials(comment.author?.full_name, comment.author?.email);
            const avatarColor = getAvatarColor(comment.user_id);

            return (
              <div key={comment.id} className={`flex gap-2.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${avatarColor}`}>
                  {initials}
                </div>
                <div className={`flex flex-col max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
                  <div className={`flex items-center gap-2 mb-0.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                    <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
                      {isOwn ? 'Ty' : displayName}
                    </span>
                    <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {formatTime(comment.created_at)}
                    </span>
                  </div>
                  <div className={`relative group px-3 py-2 rounded-2xl text-sm text-text-primary-light dark:text-text-primary-dark whitespace-pre-wrap break-words ${
                    isOwn
                      ? 'bg-brand-primary text-white rounded-tr-sm'
                      : 'bg-light-surface-variant dark:bg-dark-surface-variant rounded-tl-sm'
                  }`}>
                    {isOwn ? (
                      <span className="text-white">{comment.content}</span>
                    ) : (
                      comment.content
                    )}
                    {isOwn && (
                      <button
                        onClick={() => handleDelete(comment.id)}
                        disabled={deletingId === comment.id}
                        className="absolute -left-7 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 text-red-400 hover:text-red-600 dark:hover:text-red-400"
                        title="Usuń"
                      >
                        {deletingId === comment.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Trash2 className="w-3 h-3" />
                        }
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-4 pt-2 border-t border-slate-200 dark:border-slate-700/50">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Napisz komentarz... (Enter aby wysłać, Shift+Enter nowa linia)"
              rows={2}
              maxLength={2000}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors resize-none"
            />
            {text.length > 1800 && (
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark text-right mt-0.5">
                {text.length}/2000
              </p>
            )}
          </div>
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="flex-shrink-0 p-2.5 rounded-lg bg-brand-primary hover:bg-brand-primary/90 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
