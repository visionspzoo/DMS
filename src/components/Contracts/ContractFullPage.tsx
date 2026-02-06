import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, FileText, MessageSquare, Sparkles, MapPin, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ContractAIAssistant } from './ContractAIAssistant';
import { ContractCommentsPanel } from './ContractCommentsPanel';
import { PdfAnnotationLayer, PIN_COLORS } from './PdfAnnotationLayer';
import type { PdfAnnotation, PendingPin } from './PdfAnnotationLayer';

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

type SidebarTab = 'comments' | 'ai';

interface ContractFullPageProps {
  contractId: string;
  onBack: () => void;
}

function getColorForUser(userId: string, allUserIds: string[]): string {
  const colors = Object.keys(PIN_COLORS);
  const idx = allUserIds.indexOf(userId);
  return colors[idx % colors.length];
}

export function ContractFullPage({ contractId, onBack }: ContractFullPageProps) {
  const { user } = useAuth();
  const [contract, setContract] = useState<Contract | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>('comments');

  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [pinMode, setPinMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);

  useEffect(() => {
    loadContract();
  }, [contractId]);

  useEffect(() => {
    if (contractId) loadAnnotations();
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

  const loadAnnotations = async () => {
    const { data, error } = await supabase
      .from('contract_pdf_annotations')
      .select('*, profiles(full_name, email)')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true });

    if (!error && data) {
      setAnnotations(data);
    }
  };

  const handleOverlayClick = useCallback((page: number, x: number, y: number) => {
    setPendingPin({ page_number: page, x_percent: x, y_percent: y });
    setCommentInput('');
    setActiveAnnotationId(null);
  }, []);

  const handlePinClick = useCallback((id: string) => {
    setActiveAnnotationId(prev => prev === id ? null : id);
    setPendingPin(null);
  }, []);

  const handleCancelPending = useCallback(() => {
    setPendingPin(null);
    setCommentInput('');
  }, []);

  const handleSaveAnnotation = async () => {
    if (!user || !pendingPin || !commentInput.trim()) return;

    try {
      setSubmitting(true);
      const allUserIds = [...new Set(annotations.map(a => a.user_id))];
      if (!allUserIds.includes(user.id)) allUserIds.push(user.id);
      const color = getColorForUser(user.id, allUserIds);

      const { error } = await supabase
        .from('contract_pdf_annotations')
        .insert({
          contract_id: contractId,
          user_id: user.id,
          page_number: pendingPin.page_number,
          x_percent: pendingPin.x_percent,
          y_percent: pendingPin.y_percent,
          comment: commentInput.trim(),
          color,
        });

      if (error) throw error;

      setPendingPin(null);
      setCommentInput('');
      setPinMode(false);
      await loadAnnotations();
    } catch (err) {
      console.error('Error saving annotation:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAnnotation = async (id: string) => {
    const { error } = await supabase
      .from('contract_pdf_annotations')
      .delete()
      .eq('id', id);

    if (!error) {
      setAnnotations(prev => prev.filter(a => a.id !== id));
      if (activeAnnotationId === id) setActiveAnnotationId(null);
    }
  };

  const togglePinMode = () => {
    setPinMode(prev => !prev);
    setPendingPin(null);
    setCommentInput('');
    setActiveAnnotationId(null);
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { text: string; className: string }> = {
      draft: { text: 'Szkic', className: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400' },
      pending_specialist: { text: 'U specjalisty', className: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400' },
      pending_manager: { text: 'U kierownika', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400' },
      pending_director: { text: 'U dyrektora', className: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400' },
      pending_ceo: { text: 'U CEO', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' },
      pending_signature: { text: 'Do podpisu', className: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400' },
      signed: { text: 'Podpisana', className: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' },
      approved: { text: 'Zatwierdzona', className: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' },
      rejected: { text: 'Odrzucona', className: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' },
    };
    const badge = badges[status] || badges.draft;
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
        {badge.text}
      </span>
    );
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
        <button onClick={onBack} className="text-brand-primary hover:underline text-sm">Wroc do listy</button>
      </div>
    );
  }

  const hasPdf = !!pdfBase64 && !contract.google_doc_id;
  const allUserIds = [...new Set(annotations.map(a => a.user_id))];

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
        <div className="flex-1 overflow-hidden border-r border-slate-200 dark:border-slate-700/50">
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
            <PdfAnnotationLayer
              pdfBase64={pdfBase64}
              annotations={activeTab === 'comments' ? annotations : []}
              pinMode={activeTab === 'comments' && pinMode}
              pendingPin={activeTab === 'comments' ? pendingPin : null}
              activeAnnotationId={activeTab === 'comments' ? activeAnnotationId : null}
              commentInput={commentInput}
              submitting={submitting}
              onOverlayClick={handleOverlayClick}
              onPinClick={handlePinClick}
              onCommentChange={setCommentInput}
              onSaveAnnotation={handleSaveAnnotation}
              onCancelPending={handleCancelPending}
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

        <div className="w-[420px] flex-shrink-0 flex flex-col overflow-hidden">
          <div className="flex border-b border-slate-200 dark:border-slate-700/50 flex-shrink-0">
            <button
              onClick={() => setActiveTab('comments')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === 'comments'
                  ? 'text-brand-primary'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Komentarze
              {activeTab === 'comments' && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-brand-primary rounded-full" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === 'ai'
                  ? 'text-brand-primary'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              Asystent AI
              {activeTab === 'ai' && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-brand-primary rounded-full" />
              )}
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab === 'comments' ? (
              <ContractCommentsPanel
                contractId={contract.id}
                contractStatus={contract.status}
                currentApprover={contract.current_approver}
                onContractUpdate={loadContract}
                annotationsSection={hasPdf ? (
                  <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        Adnotacje ({annotations.length})
                      </h4>
                      <button
                        onClick={togglePinMode}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                          pinMode
                            ? 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700'
                            : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800/30 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                        }`}
                      >
                        {pinMode ? (
                          <>
                            <X className="w-3 h-3" />
                            Anuluj
                          </>
                        ) : (
                          <>
                            <MapPin className="w-3 h-3" />
                            Dodaj
                          </>
                        )}
                      </button>
                    </div>

                    {annotations.length === 0 ? (
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark py-1">
                        Kliknij "Dodaj" i zaznacz miejsce na PDF
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {annotations.map((ann, idx) => {
                          const colorKey = ann.color || getColorForUser(ann.user_id, allUserIds);
                          const colors = PIN_COLORS[colorKey] || PIN_COLORS.blue;
                          const isActive = activeAnnotationId === ann.id;

                          return (
                            <div
                              key={ann.id}
                              className={`flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all border ${
                                isActive
                                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/30'
                                  : 'border-transparent hover:bg-slate-50 dark:hover:bg-dark-surface-variant'
                              }`}
                              onClick={() => handlePinClick(ann.id)}
                            >
                              <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                                <MapPin className={`w-3.5 h-3.5 ${colors.text}`} fill="currentColor" strokeWidth={0} />
                                <span className="text-[10px] font-bold text-text-secondary-light dark:text-text-secondary-dark w-3 text-center">
                                  {idx + 1}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                                    {ann.profiles?.full_name || 'Uzytkownik'}
                                  </span>
                                  <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0">
                                    str. {ann.page_number} | {new Date(ann.created_at).toLocaleString('pl-PL', {
                                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark line-clamp-2 mt-0.5 leading-relaxed">
                                  {ann.comment}
                                </p>
                              </div>
                              {user?.id === ann.user_id && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteAnnotation(ann.id);
                                  }}
                                  className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : undefined}
              />
            ) : (
              <ContractAIAssistant
                contractId={contract.id}
                contractTitle={contract.title}
                pdfBase64={pdfBase64}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
