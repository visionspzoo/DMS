import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X, Trash2, Sparkles, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface Comment {
  id: string;
  comment: string;
  highlighted_text: string | null;
  position_data: any;
  comment_type: string;
  created_at: string;
  user_id: string;
  profiles?: { full_name: string; email: string };
}

interface ContractViewerProps {
  contractId: string;
  pdfBase64: string | null;
  googleDocId: string | null;
  contractTitle: string;
}

export function ContractViewer({ contractId, pdfBase64, googleDocId, contractTitle }: ContractViewerProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [selectedText, setSelectedText] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    loadComments();
  }, [contractId]);

  const loadComments = async () => {
    try {
      const { data, error } = await supabase
        .from('contract_comments')
        .select(`
          *,
          profiles(full_name, email)
        `)
        .eq('contract_id', contractId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  };

  const handleTextSelection = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (text && text.length > 0) {
      setSelectedText(text);
      setShowCommentBox(true);
    }
  };

  const handleAddComment = async () => {
    if (!user || !newComment.trim()) return;

    try {
      setCommentSubmitting(true);

      const commentData: any = {
        contract_id: contractId,
        user_id: user.id,
        comment: newComment.trim(),
      };

      if (selectedText) {
        commentData.comment_type = 'contextual';
        commentData.highlighted_text = selectedText;
        commentData.position_data = { type: 'text' };
      } else {
        commentData.comment_type = 'general';
      }

      const { error } = await supabase
        .from('contract_comments')
        .insert(commentData);

      if (error) throw error;

      setNewComment('');
      setSelectedText('');
      setShowCommentBox(false);
      await loadComments();
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Nie udało się dodać komentarza');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten komentarz?')) return;

    try {
      const { error } = await supabase
        .from('contract_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;
      await loadComments();
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert('Nie udało się usunąć komentarza');
    }
  };

  const contextualComments = comments.filter(c => c.comment_type === 'contextual');
  const generalComments = comments.filter(c => c.comment_type === 'general');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* Document Viewer - Left/Center */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {googleDocId ? (
            <div className="flex flex-col items-center justify-center h-[600px] p-8 bg-gradient-to-br from-blue-50 to-slate-50">
              <FileText className="w-16 h-16 text-blue-600 mb-4" />
              <h4 className="text-xl font-semibold text-slate-900 mb-2">Dokument Google Docs</h4>
              <p className="text-slate-600 text-center mb-6 max-w-md">
                Otwórz dokument w Google Docs, aby dodawać komentarze bezpośrednio w dokumencie.
              </p>
              <a
                href={`https://docs.google.com/document/d/${googleDocId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-medium shadow-md"
              >
                <FileText className="w-5 h-5" />
                Otwórz w Google Docs
              </a>
            </div>
          ) : pdfBase64 ? (
            <div className="relative" onMouseUp={handleTextSelection}>
              <iframe
                ref={iframeRef}
                src={`data:application/pdf;base64,${pdfBase64}`}
                className="w-full h-[600px]"
                title="Podgląd PDF"
              />
              {showCommentBox && selectedText && (
                <div className="absolute top-4 right-4 bg-white border-2 border-blue-500 rounded-lg shadow-xl p-4 w-80 z-10">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-slate-900 text-sm">Dodaj komentarz do zaznaczenia</h4>
                    <button
                      onClick={() => {
                        setShowCommentBox(false);
                        setSelectedText('');
                      }}
                      className="p-1 hover:bg-slate-100 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                    <p className="text-slate-700 italic">"{selectedText.substring(0, 100)}..."</p>
                  </div>
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm mb-2"
                    placeholder="Twój komentarz..."
                    autoFocus
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={commentSubmitting || !newComment.trim()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
                  >
                    <Send className="w-4 h-4" />
                    {commentSubmitting ? 'Dodawanie...' : 'Dodaj komentarz'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[600px] bg-slate-50">
              <p className="text-slate-500">Brak podglądu dokumentu</p>
            </div>
          )}
        </div>

        {/* General Comments Section */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Komentarze ogólne ({generalComments.length})
          </h4>

          <div className="space-y-3 mb-4">
            {generalComments.map((comment) => (
              <div
                key={comment.id}
                className="bg-slate-50 border border-slate-200 rounded-lg p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900 text-sm">
                        {comment.profiles?.full_name || comment.profiles?.email || 'Użytkownik'}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(comment.created_at).toLocaleString('pl-PL')}
                      </span>
                    </div>
                    <p className="text-slate-700 text-sm whitespace-pre-wrap">{comment.comment}</p>
                  </div>
                  {user?.id === comment.user_id && (
                    <button
                      onClick={() => handleDeleteComment(comment.id)}
                      className="p-1 hover:bg-red-50 rounded text-red-600 transition-colors"
                      title="Usuń komentarz"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 pt-3">
            <textarea
              value={selectedText ? '' : newComment}
              onChange={(e) => {
                setSelectedText('');
                setNewComment(e.target.value);
              }}
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm mb-2"
              placeholder="Dodaj komentarz ogólny..."
            />
            <button
              onClick={handleAddComment}
              disabled={commentSubmitting || !newComment.trim() || !!selectedText}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
            >
              <Send className="w-4 h-4" />
              {commentSubmitting ? 'Wysyłanie...' : 'Wyślij'}
            </button>
          </div>
        </div>
      </div>

      {/* Comments & Annotations Panel - Right */}
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-yellow-600" />
            Komentarze w tekście ({contextualComments.length})
          </h4>

          {contextualComments.length === 0 ? (
            <div className="text-center py-6 text-slate-500 bg-slate-50 rounded-lg">
              <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm">Zaznacz tekst w dokumencie, aby dodać komentarz</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {contextualComments.map((comment) => (
                <div
                  key={comment.id}
                  className={`border-2 rounded-lg p-3 cursor-pointer transition-all ${
                    activeCommentId === comment.id
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-slate-200 bg-white hover:border-yellow-300'
                  }`}
                  onClick={() => setActiveCommentId(comment.id)}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-slate-900 text-xs">
                          {comment.profiles?.full_name || 'Użytkownik'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(comment.created_at).toLocaleString('pl-PL', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>
                    {user?.id === comment.user_id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteComment(comment.id);
                        }}
                        className="p-1 hover:bg-red-50 rounded text-red-600 transition-colors"
                        title="Usuń"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {comment.highlighted_text && (
                    <div className="mb-2 p-2 bg-yellow-100 border border-yellow-300 rounded text-xs">
                      <p className="text-slate-700 italic line-clamp-2">
                        "{comment.highlighted_text}"
                      </p>
                    </div>
                  )}

                  <p className="text-slate-700 text-sm">{comment.comment}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
