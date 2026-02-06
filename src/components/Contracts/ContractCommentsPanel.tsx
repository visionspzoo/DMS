import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, Send, Trash2, Highlighter } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface Approval {
  id: string;
  approver_role: string;
  status: string;
  comment: string | null;
  approved_at: string | null;
  profiles: { full_name: string };
}

interface Comment {
  id: string;
  comment: string;
  highlighted_text: string | null;
  comment_type: string;
  created_at: string;
  user_id: string;
  profiles?: { full_name: string; email: string };
}

interface ContractCommentsPanelProps {
  contractId: string;
  contractStatus: string;
  currentApprover: string | null;
  onContractUpdate: () => void;
}

export function ContractCommentsPanel({
  contractId,
  contractStatus,
  currentApprover,
  onContractUpdate,
}: ContractCommentsPanelProps) {
  const { user } = useAuth();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingApprovals, setLoadingApprovals] = useState(true);
  const [approvalComment, setApprovalComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  useEffect(() => {
    loadApprovals();
    loadComments();
  }, [contractId]);

  const loadApprovals = async () => {
    try {
      const { data, error } = await supabase
        .from('contract_approvals')
        .select('*, profiles!approver_id(full_name)')
        .eq('contract_id', contractId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setApprovals(data || []);
    } catch (error) {
      console.error('Error loading approvals:', error);
    } finally {
      setLoadingApprovals(false);
    }
  };

  const loadComments = async () => {
    try {
      const { data, error } = await supabase
        .from('contract_comments')
        .select('*, profiles(full_name, email)')
        .eq('contract_id', contractId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  };

  const handleApprove = async () => {
    if (!user) return;
    try {
      setSubmitting(true);
      const myApproval = approvals.find(a => a.profiles && a.approver_role);
      if (!myApproval) return;

      await supabase
        .from('contract_approvals')
        .update({
          status: 'approved',
          comment: approvalComment || null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', myApproval.id);

      const roleMapping: Record<string, string> = {
        manager: 'pending_director',
        director: 'pending_ceo',
        ceo: 'approved',
      };
      const nextStatus = roleMapping[myApproval.approver_role] || contractStatus;

      await supabase
        .from('contracts')
        .update({ status: nextStatus })
        .eq('id', contractId);

      setApprovalComment('');
      onContractUpdate();
      loadApprovals();
    } catch (error) {
      console.error('Error approving:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!user) return;
    try {
      setSubmitting(true);
      const myApproval = approvals.find(a => a.profiles && a.approver_role);
      if (!myApproval) return;

      await supabase
        .from('contract_approvals')
        .update({
          status: 'rejected',
          comment: approvalComment || null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', myApproval.id);

      await supabase
        .from('contracts')
        .update({ status: 'rejected' })
        .eq('id', contractId);

      setApprovalComment('');
      onContractUpdate();
      loadApprovals();
    } catch (error) {
      console.error('Error rejecting:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddComment = async () => {
    if (!user || !newComment.trim()) return;
    try {
      setCommentSubmitting(true);
      const { error } = await supabase
        .from('contract_comments')
        .insert({
          contract_id: contractId,
          user_id: user.id,
          comment: newComment.trim(),
          comment_type: 'general',
        });

      if (error) throw error;
      setNewComment('');
      await loadComments();
    } catch (error) {
      console.error('Error adding comment:', error);
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Czy na pewno chcesz usunac ten komentarz?')) return;
    try {
      const { error } = await supabase
        .from('contract_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;
      await loadComments();
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = { manager: 'Kierownik', director: 'Dyrektor', ceo: 'CEO' };
    return labels[role] || role;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'rejected': return <XCircle className="w-4 h-4 text-red-600" />;
      default: return <Clock className="w-4 h-4 text-yellow-600" />;
    }
  };

  const canApprove = contractStatus.startsWith('pending') && currentApprover === user?.id;

  return (
    <div className="h-full flex flex-col bg-light-surface dark:bg-dark-surface">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {loadingApprovals ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-primary"></div>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                Akceptacje
              </h4>
              {approvals.length === 0 ? (
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark py-2">
                  Brak akceptacji dla tej umowy
                </p>
              ) : (
                <div className="space-y-2">
                  {approvals.map((approval) => (
                    <div
                      key={approval.id}
                      className={`flex items-start gap-3 p-3 rounded-lg text-sm transition-colors ${
                        approval.status === 'approved'
                          ? 'bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30'
                          : approval.status === 'rejected'
                          ? 'bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30'
                          : 'bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800/30'
                      }`}
                    >
                      <div className="mt-0.5 flex-shrink-0">{getStatusIcon(approval.status)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-text-primary-light dark:text-text-primary-dark text-xs">
                            {getRoleLabel(approval.approver_role)}
                          </span>
                          {approval.profiles?.full_name && (
                            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                              - {approval.profiles.full_name}
                            </span>
                          )}
                        </div>
                        {approval.status === 'approved' && approval.approved_at && (
                          <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                            Zatwierdzono {new Date(approval.approved_at).toLocaleString('pl-PL')}
                          </p>
                        )}
                        {approval.status === 'rejected' && approval.approved_at && (
                          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                            Odrzucono {new Date(approval.approved_at).toLocaleString('pl-PL')}
                          </p>
                        )}
                        {approval.status === 'pending' && (
                          <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
                            Oczekuje na zatwierdzenie
                          </p>
                        )}
                        {approval.comment && (
                          <div className="mt-2 p-2 bg-white/60 dark:bg-dark-surface/60 rounded border border-slate-200/50 dark:border-slate-700/30">
                            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{approval.comment}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canApprove && (
              <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4 space-y-3">
                <h4 className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                  Twoja decyzja
                </h4>
                <textarea
                  value={approvalComment}
                  onChange={(e) => setApprovalComment(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
                  placeholder="Komentarz (opcjonalny)..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleReject}
                    disabled={submitting}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
                  >
                    <XCircle className="w-4 h-4" />
                    Odrzuc
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={submitting}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Zatwierdz
                  </button>
                </div>
              </div>
            )}

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4 space-y-2.5">
              <h4 className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                Komentarze ({comments.length})
              </h4>
              {comments.length === 0 ? (
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark py-2">Brak komentarzy</p>
              ) : (
                <div className="space-y-2">
                  {comments.map((c) => (
                    <div key={c.id} className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            {c.comment_type === 'contextual' && (
                              <Highlighter className="w-3 h-3 text-amber-500 flex-shrink-0" />
                            )}
                            <span className="font-medium text-text-primary-light dark:text-text-primary-dark text-xs">
                              {c.profiles?.full_name || 'Uzytkownik'}
                            </span>
                            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                              {new Date(c.created_at).toLocaleString('pl-PL')}
                            </span>
                          </div>
                          {c.highlighted_text && (
                            <div className="mb-1.5 px-2 py-1 bg-amber-50 dark:bg-amber-900/20 border-l-2 border-amber-400 rounded text-xs italic text-text-secondary-light dark:text-text-secondary-dark line-clamp-2">
                              &ldquo;{c.highlighted_text}&rdquo;
                            </div>
                          )}
                          <p className="text-sm text-text-primary-light dark:text-text-primary-dark leading-relaxed">{c.comment}</p>
                        </div>
                        {user?.id === c.user_id && (
                          <button
                            onClick={() => handleDeleteComment(c.id)}
                            className="p-1 hover:bg-red-50 dark:hover:bg-red-900/10 rounded text-red-500 transition-colors flex-shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="px-4 pb-3 pt-2 border-t border-slate-200 dark:border-slate-700/50 flex-shrink-0">
        <div className="flex gap-2">
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
            placeholder="Dodaj komentarz..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAddComment();
              }
            }}
          />
          <button
            onClick={handleAddComment}
            disabled={commentSubmitting || !newComment.trim()}
            className="px-3 py-2 bg-brand-primary text-white hover:bg-brand-primary-hover rounded-lg transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
