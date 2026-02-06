import { useState, useEffect } from 'react';
import { ArrowLeft, CheckCircle, XCircle, Clock, FileText, MessageSquare, Send, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ContractAIAssistant } from './ContractAIAssistant';

interface Contract {
  id: string;
  contract_number: string;
  title: string;
  description: string;
  file_url: string;
  google_doc_id: string | null;
  status: string;
  current_approver: string | null;
  created_at: string;
  updated_at: string;
  uploaded_by: string;
  department_id: string | null;
  departments?: { name: string };
}

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

interface ContractFullPageProps {
  contractId: string;
  onBack: () => void;
}

export function ContractFullPage({ contractId, onBack }: ContractFullPageProps) {
  const { user } = useAuth();
  const [contract, setContract] = useState<Contract | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  useEffect(() => {
    loadContract();
    loadApprovals();
    loadComments();
  }, [contractId]);

  const loadContract = async () => {
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, departments(name)')
        .eq('id', contractId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setContract(data);
        if (!data.google_doc_id) {
          loadPdfData(data.id);
        }
      }
    } catch (error) {
      console.error('Error loading contract:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPdfData = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('pdf_base64')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (data?.pdf_base64) {
        setPdfBase64(data.pdf_base64);
      }
    } catch (error) {
      console.error('Error loading PDF data:', error);
    }
  };

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
    if (!user || !contract) return;
    try {
      setSubmitting(true);
      const myApproval = approvals.find(a => a.profiles && a.approver_role);
      if (!myApproval) return;

      await supabase
        .from('contract_approvals')
        .update({
          status: 'approved',
          comment: comment || null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', myApproval.id);

      const roleMapping: Record<string, string> = {
        manager: 'pending_director',
        director: 'pending_ceo',
        ceo: 'approved',
      };
      const nextStatus = roleMapping[myApproval.approver_role] || contract.status;

      await supabase
        .from('contracts')
        .update({ status: nextStatus })
        .eq('id', contract.id);

      loadContract();
      loadApprovals();
    } catch (error) {
      console.error('Error approving:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!user || !contract) return;
    try {
      setSubmitting(true);
      const myApproval = approvals.find(a => a.profiles && a.approver_role);
      if (!myApproval) return;

      await supabase
        .from('contract_approvals')
        .update({
          status: 'rejected',
          comment: comment || null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', myApproval.id);

      await supabase
        .from('contracts')
        .update({ status: 'rejected' })
        .eq('id', contract.id);

      loadContract();
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

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { text: string; className: string }> = {
      draft: { text: 'Szkic', className: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
      pending_manager: { text: 'Oczekuje na kierownika', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
      pending_director: { text: 'Oczekuje na dyrektora', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
      pending_ceo: { text: 'Oczekuje na CEO', className: 'bg-blue-100 text-brand-primary dark:bg-blue-900/30' },
      approved: { text: 'Zatwierdzona', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      rejected: { text: 'Odrzucona', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    };
    const badge = badges[status] || badges.draft;
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
        {badge.text}
      </span>
    );
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Nie znaleziono umowy</p>
        <button onClick={onBack} className="text-brand-primary hover:underline text-sm">Wróc do listy</button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-light-bg dark:bg-dark-bg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-light-surface dark:bg-dark-surface border-b border-slate-200 dark:border-slate-700/50 flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark truncate">
              {contract.title}
            </h1>
            {getStatusBadge(contract.status)}
          </div>
          <div className="flex items-center gap-3 text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
            <span className="font-mono">{contract.contract_number}</span>
            <span>{new Date(contract.created_at).toLocaleDateString('pl-PL')}</span>
            {contract.departments && <span>Dzial: {contract.departments.name}</span>}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-200 dark:border-slate-700/50">
          <div className="flex-1 overflow-hidden">
            {contract.google_doc_id ? (
              <div className="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-blue-50 to-slate-50 dark:from-dark-surface dark:to-dark-bg">
                <FileText className="w-14 h-14 text-brand-primary mb-4" />
                <h4 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">Dokument Google Docs</h4>
                <p className="text-text-secondary-light dark:text-text-secondary-dark text-center mb-6 max-w-md text-sm">
                  Otworz dokument w Google Docs, aby dodawac komentarze bezposrednio w dokumencie.
                </p>
                <a
                  href={`https://docs.google.com/document/d/${contract.google_doc_id}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-white hover:bg-brand-primary-hover rounded-lg transition-colors font-medium text-sm shadow-md"
                >
                  <FileText className="w-4 h-4" />
                  Otworz w Google Docs
                </a>
              </div>
            ) : pdfBase64 ? (
              <iframe
                src={`data:application/pdf;base64,${pdfBase64}`}
                className="w-full h-full"
                title="Podglad PDF"
              />
            ) : (
              <div className="flex items-center justify-center h-full bg-light-surface-variant dark:bg-dark-surface-variant">
                <div className="text-center">
                  <FileText className="w-12 h-12 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-3" />
                  <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">Brak podgladu dokumentu</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 bg-light-surface dark:bg-dark-surface border-t border-slate-200 dark:border-slate-700/50">
            <details className="group">
              <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors">
                <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Komentarze ({comments.length}) i akceptacje ({approvals.length})
                </span>
                <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark group-open:rotate-180 transition-transform">&#9660;</span>
              </summary>

              <div className="max-h-[300px] overflow-y-auto px-4 pb-4 space-y-4">
                {approvals.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Akceptacje</h4>
                    {approvals.map((approval) => (
                      <div
                        key={approval.id}
                        className={`flex items-start gap-3 p-2.5 rounded-lg text-sm ${
                          approval.status === 'approved'
                            ? 'bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30'
                            : approval.status === 'rejected'
                            ? 'bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30'
                            : 'bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800/30'
                        }`}
                      >
                        {getStatusIcon(approval.status)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-text-primary-light dark:text-text-primary-dark text-xs">
                              {getRoleLabel(approval.approver_role)}
                            </span>
                            {approval.profiles?.full_name && (
                              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                - {approval.profiles.full_name}
                              </span>
                            )}
                          </div>
                          {approval.comment && (
                            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">{approval.comment}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {contract.status.startsWith('pending') && contract.current_approver === user?.id && (
                  <div className="border-t border-slate-200 dark:border-slate-700/50 pt-3 space-y-3">
                    <h4 className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Twoja decyzja</h4>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
                      placeholder="Komentarz (opcjonalny)..."
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleReject}
                        disabled={submitting}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors disabled:opacity-50 text-sm"
                      >
                        <XCircle className="w-4 h-4" />
                        Odrzuc
                      </button>
                      <button
                        onClick={handleApprove}
                        disabled={submitting}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Zatwierdz
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Komentarze</h4>
                  {comments.length === 0 ? (
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark py-2">Brak komentarzy</p>
                  ) : (
                    comments.map((c) => (
                      <div key={c.id} className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="font-medium text-text-primary-light dark:text-text-primary-dark text-xs">
                                {c.profiles?.full_name || 'Uzytkownik'}
                              </span>
                              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                {new Date(c.created_at).toLocaleString('pl-PL')}
                              </span>
                            </div>
                            <p className="text-sm text-text-primary-light dark:text-text-primary-dark">{c.comment}</p>
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
                    ))
                  )}
                  <div className="flex gap-2 pt-1">
                    <input
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm"
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
                      className="px-3 py-1.5 bg-brand-primary text-white hover:bg-brand-primary-hover rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>

        <div className="w-[420px] flex-shrink-0 flex flex-col overflow-hidden">
          <ContractAIAssistant
            contractId={contract.id}
            contractTitle={contract.title}
            pdfBase64={pdfBase64}
          />
        </div>
      </div>
    </div>
  );
}
