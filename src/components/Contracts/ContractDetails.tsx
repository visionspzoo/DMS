import { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, Clock, Sparkles, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ContractViewer } from './ContractViewer';
import { AIAssistant } from './AIAssistant';

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
}

interface Approval {
  id: string;
  approver_role: string;
  status: string;
  comment: string | null;
  approved_at: string | null;
  profiles: { full_name: string };
}


interface ContractDetailsProps {
  contract: Contract;
  onClose: () => void;
  onUpdate: () => void;
}

export function ContractDetails({ contract, onClose, onUpdate }: ContractDetailsProps) {
  const { user } = useAuth();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [showAI, setShowAI] = useState(true);

  useEffect(() => {
    loadApprovals();
    loadPdfData();
  }, [contract.id]);

  const loadApprovals = async () => {
    try {
      const { data, error } = await supabase
        .from('contract_approvals')
        .select(`
          *,
          profiles!approver_id(full_name)
        `)
        .eq('contract_id', contract.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setApprovals(data || []);
    } catch (error) {
      console.error('Error loading approvals:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPdfData = async () => {
    if (!contract.google_doc_id) {
      try {
        const { data, error } = await supabase
          .from('contracts')
          .select('pdf_base64')
          .eq('id', contract.id)
          .single();

        if (error) throw error;
        if (data?.pdf_base64) {
          setPdfBase64(data.pdf_base64);
        }
      } catch (error) {
        console.error('Error loading PDF data:', error);
      }
    }
  };


  const handleSendForward = async () => {
    if (!user) return;

    try {
      setSubmitting(true);

      if (contract.status === 'pending_signature') {
        await supabase
          .from('contracts')
          .update({ status: 'signed' })
          .eq('id', contract.id);
        onUpdate();
        onClose();
        return;
      }

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
        specialist: 'pending_manager',
        manager: 'pending_director',
        director: 'pending_ceo',
        ceo: 'pending_signature',
      };

      const nextStatus = roleMapping[myApproval.approver_role] || contract.status;

      await supabase
        .from('contracts')
        .update({ status: nextStatus })
        .eq('id', contract.id);

      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error sending forward:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    await handleSendForward();
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
          comment: comment || null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', myApproval.id);

      await supabase
        .from('contracts')
        .update({ status: 'rejected' })
        .eq('id', contract.id);

      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error rejecting:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      specialist: 'Specjalista',
      manager: 'Kierownik',
      director: 'Dyrektor',
      ceo: 'CEO',
    };
    return labels[role] || role;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'rejected':
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-600" />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{contract.title}</h2>
            <p className="text-sm text-slate-500 mt-1">{contract.contract_number}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {contract.description && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Opis</h3>
              <p className="text-slate-600">{contract.description}</p>
            </div>
          )}

          {/* Document Viewer with Comments and AI */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
            <div className="xl:col-span-3">
              <ContractViewer
                contractId={contract.id}
                pdfBase64={pdfBase64}
                googleDocId={contract.google_doc_id}
                contractTitle={contract.title}
              />
            </div>

            {showAI && (
              <div className="xl:col-span-1">
                <AIAssistant
                  contractId={contract.id}
                  contractTitle={contract.title}
                  pdfBase64={pdfBase64}
                />
              </div>
            )}
          </div>

          {!showAI && (
            <div className="flex justify-center">
              <button
                onClick={() => setShowAI(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 rounded-lg transition-colors font-medium shadow-md"
              >
                <Sparkles className="w-5 h-5" />
                Pokaż asystenta AI
              </button>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Proces akceptacji i komentarze</h3>
            {loading ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
              </div>
            ) : (
              <div className="space-y-3">
                {approvals.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <p>Brak akceptacji dla tej umowy</p>
                  </div>
                ) : (
                  approvals.map((approval) => (
                    <div
                      key={approval.id}
                      className={`flex items-start gap-4 p-4 border-2 rounded-lg transition-all ${
                        approval.status === 'approved'
                          ? 'border-green-200 bg-green-50'
                          : approval.status === 'rejected'
                          ? 'border-red-200 bg-red-50'
                          : 'border-yellow-200 bg-yellow-50'
                      }`}
                    >
                      <div className="flex-shrink-0 mt-1">
                        {getStatusIcon(approval.status)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-slate-900">
                            {getRoleLabel(approval.approver_role)}
                          </span>
                          {approval.profiles?.full_name && (
                            <span className="text-sm text-slate-600">
                              • {approval.profiles.full_name}
                            </span>
                          )}
                        </div>
                        {approval.status === 'approved' && (
                          <p className="text-sm font-medium text-green-700">
                            ✓ Zatwierdzono {approval.approved_at ? new Date(approval.approved_at).toLocaleString('pl-PL') : ''}
                          </p>
                        )}
                        {approval.status === 'rejected' && (
                          <p className="text-sm font-medium text-red-700">
                            ✗ Odrzucono {approval.approved_at ? new Date(approval.approved_at).toLocaleString('pl-PL') : ''}
                          </p>
                        )}
                        {approval.status === 'pending' && (
                          <p className="text-sm font-medium text-yellow-700">⏳ Oczekuje na zatwierdzenie</p>
                        )}
                        {approval.comment && (
                          <div className="mt-3 p-3 bg-white border border-slate-200 rounded-md">
                            <p className="text-xs font-semibold text-slate-500 mb-1">Komentarz:</p>
                            <p className="text-sm text-slate-700">
                              {approval.comment}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>


          {contract.status.startsWith('pending') && contract.current_approver === user?.id && (
            <div className="border-t border-slate-200 pt-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">
                {contract.status === 'pending_signature' ? 'Podpisz umowę' : 'Twoja decyzja'}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Komentarz (opcjonalny)
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                    placeholder="Dodaj komentarz do swojej decyzji..."
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleReject}
                    disabled={submitting}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-red-600 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-5 h-5" />
                    Odrzuć
                  </button>
                  <button
                    onClick={handleSendForward}
                    disabled={submitting}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <ArrowRight className="w-5 h-5" />
                    {contract.status === 'pending_signature' ? 'Podpisz' : 'Prześlij dalej'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
