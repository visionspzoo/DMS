import { useState, useEffect } from 'react';
import { FileText, Upload, Clock, CheckCircle, XCircle, Eye } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { UploadContract } from './UploadContract';

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
  uploader?: { full_name: string };
}

interface ContractsPageProps {
  onOpenContract: (id: string) => void;
}

export function ContractsPage({ onOpenContract }: ContractsPageProps) {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    if (user) {
      loadContracts();
    }
  }, [user, statusFilter]);

  const loadContracts = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('contracts')
        .select(`
          *,
          departments(name)
        `)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setContracts(data || []);
    } catch (error: any) {
      console.error('Error loading contracts:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { text: string; className: string; icon: any }> = {
      draft: { text: 'Szkic', className: 'bg-slate-500/10 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400', icon: FileText },
      pending_manager: { text: 'Oczekuje na kierownika', className: 'bg-yellow-500/10 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-400', icon: Clock },
      pending_director: { text: 'Oczekuje na dyrektora', className: 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400', icon: Clock },
      pending_ceo: { text: 'Oczekuje na CEO', className: 'bg-brand-primary/10 text-brand-primary dark:bg-brand-primary/20', icon: Clock },
      approved: { text: 'Zatwierdzona', className: 'bg-status-success/10 text-status-success dark:bg-status-success/20', icon: CheckCircle },
      rejected: { text: 'Odrzucona', className: 'bg-status-error/10 text-status-error dark:bg-status-error/20', icon: XCircle },
    };

    const badge = badges[status] || badges.draft;
    const Icon = badge.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
        <Icon className="w-3 h-3" />
        {badge.text}
      </span>
    );
  };

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg p-4 overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Obieg umów</h1>
          <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
            Zarządzaj umowami i śledź proces akceptacji
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-3 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg transition-colors font-medium text-sm"
        >
          <Upload className="w-4 h-4" />
          Dodaj umowę
        </button>
      </div>

      <div className="mb-4 flex gap-2 bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-1">
        <button
          onClick={() => setStatusFilter('all')}
          className={`flex-1 px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
            statusFilter === 'all'
              ? 'bg-brand-primary text-white'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          Wszystkie
        </button>
        <button
          onClick={() => setStatusFilter('pending_manager')}
          className={`flex-1 px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
            statusFilter === 'pending_manager'
              ? 'bg-brand-primary text-white'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          Oczekujące
        </button>
        <button
          onClick={() => setStatusFilter('approved')}
          className={`flex-1 px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
            statusFilter === 'approved'
              ? 'bg-brand-primary text-white'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          Zatwierdzone
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
        </div>
      ) : contracts.length === 0 ? (
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-8 text-center">
          <FileText className="w-12 h-12 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-3" />
          <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
            Brak umów
          </h3>
          <p className="text-text-secondary-light dark:text-text-secondary-dark mb-4 text-sm">
            Dodaj pierwszą umowę, aby rozpocząć
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg transition-colors font-medium text-sm"
          >
            <Upload className="w-4 h-4" />
            Dodaj umowę
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {contracts.map((contract) => (
            <div
              key={contract.id}
              onClick={() => onOpenContract(contract.id)}
              className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-3 hover:border-brand-primary/30 transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-mono text-text-secondary-light dark:text-text-secondary-dark">
                      {contract.contract_number}
                    </span>
                    {getStatusBadge(contract.status)}
                  </div>
                  <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-1 truncate">
                    {contract.title}
                  </h3>
                  {contract.description && (
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-2 line-clamp-2">
                      {contract.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    <span>
                      {new Date(contract.created_at).toLocaleDateString('pl-PL')}
                    </span>
                    {contract.departments && (
                      <span>Dział: {contract.departments.name}</span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <Eye className="w-4 h-4 text-brand-primary" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <UploadContract
          onClose={() => setShowUpload(false)}
          onSuccess={() => {
            setShowUpload(false);
            loadContracts();
          }}
        />
      )}

    </div>
  );
}
