import { useState, useEffect } from 'react';
import { ArrowLeft, FileText, MessageSquare, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ContractAIAssistant } from './ContractAIAssistant';
import { ContractCommentsPanel } from './ContractCommentsPanel';

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

export function ContractFullPage({ contractId, onBack }: ContractFullPageProps) {
  const { user } = useAuth();
  const [contract, setContract] = useState<Contract | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>('comments');

  useEffect(() => {
    loadContract();
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
