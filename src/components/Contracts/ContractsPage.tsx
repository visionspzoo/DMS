import { useState, useEffect } from 'react';
import { FileText, Upload, Clock, CheckCircle, PenTool, Eye, Inbox, Send, FileSignature } from 'lucide-react';
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
}

type TabKey = 'robocze' | 'oczekujace' | 'do_podpisu' | 'podpisane';

interface ContractsPageProps {
  onOpenContract: (id: string) => void;
}

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  draft: { text: 'Szkic', className: 'bg-slate-500/10 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400' },
  pending_specialist: { text: 'U specjalisty', className: 'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400' },
  pending_manager: { text: 'U kierownika', className: 'bg-yellow-500/10 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-400' },
  pending_director: { text: 'U dyrektora', className: 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400' },
  pending_ceo: { text: 'U CEO', className: 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400' },
  pending_signature: { text: 'Do podpisu', className: 'bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400' },
  signed: { text: 'Podpisana', className: 'bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400' },
  approved: { text: 'Zatwierdzona', className: 'bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400' },
  rejected: { text: 'Odrzucona', className: 'bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400' },
};

export function ContractsPage({ onOpenContract }: ContractsPageProps) {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('robocze');
  const [counts, setCounts] = useState<Record<TabKey, number>>({ robocze: 0, oczekujace: 0, do_podpisu: 0, podpisane: 0 });
  const [userRole, setUserRole] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadUserRole();
      loadContracts();
      loadCounts();
    }
  }, [user, activeTab]);

  const loadUserRole = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (data) setUserRole(data.role);
    } catch (error) {
      console.error('Error loading user role:', error);
    }
  };

  const loadCounts = async () => {
    if (!user) return;
    try {
      const { data: all } = await supabase
        .from('contracts')
        .select('id, uploaded_by, current_approver, status');

      if (!all) return;

      setCounts({
        robocze: all.filter(c => c.uploaded_by === user.id).length,
        oczekujace: all.filter(c => c.current_approver === user.id && c.status.startsWith('pending_')).length,
        do_podpisu: all.filter(c => c.status === 'pending_signature').length,
        podpisane: all.filter(c => c.status === 'signed').length,
      });
    } catch {
      // ignore
    }
  };

  const loadContracts = async () => {
    if (!user) return;
    try {
      setLoading(true);
      let query = supabase
        .from('contracts')
        .select('*, departments(name)')
        .order('created_at', { ascending: false });

      switch (activeTab) {
        case 'robocze':
          query = query.eq('uploaded_by', user.id);
          break;
        case 'oczekujace':
          query = query.eq('current_approver', user.id).in('status', ['pending_specialist', 'pending_manager', 'pending_director', 'pending_ceo']);
          break;
        case 'do_podpisu':
          query = query.eq('status', 'pending_signature');
          break;
        case 'podpisane':
          query = query.eq('status', 'signed');
          break;
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

  const sendToApproval = async (e: React.MouseEvent, contractId: string) => {
    e.stopPropagation();
    if (!user || !userRole || sendingId) return;

    try {
      setSendingId(contractId);

      const roleMapping: Record<string, { status: string; approverRole: string }> = {
        'Specjalista': { status: 'pending_manager', approverRole: 'manager' },
        'Kierownik': { status: 'pending_director', approverRole: 'director' },
        'Dyrektor': { status: 'pending_ceo', approverRole: 'ceo' },
      };

      const mapping = roleMapping[userRole];
      if (!mapping) {
        alert('Nie mozesz wyslac tej umowy do akceptacji');
        return;
      }

      const { data: approverData } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', mapping.approverRole === 'manager' ? 'Kierownik' : mapping.approverRole === 'director' ? 'Dyrektor' : 'CEO')
        .limit(1)
        .single();

      if (!approverData) {
        alert('Nie znaleziono osoby do akceptacji');
        return;
      }

      await supabase
        .from('contracts')
        .update({
          status: mapping.status,
          current_approver: approverData.id,
        })
        .eq('id', contractId);

      await supabase
        .from('contract_approvals')
        .insert({
          contract_id: contractId,
          approver_id: approverData.id,
          approver_role: mapping.approverRole,
          status: 'pending',
        });

      loadContracts();
      loadCounts();
    } catch (error) {
      console.error('Error sending to approval:', error);
      alert('Blad podczas wysylania do akceptacji');
    } finally {
      setSendingId(null);
    }
  };

  const sendToSignature = async (e: React.MouseEvent, contractId: string) => {
    e.stopPropagation();
    if (!user || sendingId) return;

    try {
      setSendingId(contractId);

      const { data: ceoData } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'CEO')
        .limit(1)
        .single();

      if (!ceoData) {
        alert('Nie znaleziono CEO');
        return;
      }

      await supabase
        .from('contracts')
        .update({
          status: 'pending_signature',
          current_approver: ceoData.id,
        })
        .eq('id', contractId);

      loadContracts();
      loadCounts();
    } catch (error) {
      console.error('Error sending to signature:', error);
      alert('Blad podczas wysylania do podpisu');
    } finally {
      setSendingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const badge = STATUS_LABELS[status] || STATUS_LABELS.draft;
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
        {badge.text}
      </span>
    );
  };

  const tabs: { key: TabKey; label: string; icon: typeof FileText }[] = [
    { key: 'robocze', label: 'Robocze', icon: FileText },
    { key: 'oczekujace', label: 'Oczekujace', icon: Inbox },
    { key: 'do_podpisu', label: 'Do podpisu', icon: PenTool },
    { key: 'podpisane', label: 'Podpisane', icon: CheckCircle },
  ];

  const emptyMessages: Record<TabKey, { title: string; desc: string }> = {
    robocze: { title: 'Brak umow', desc: 'Dodaj pierwsza umowe, aby rozpoczac' },
    oczekujace: { title: 'Brak oczekujacych', desc: 'Nie masz umow czekajacych na Twoja decyzje' },
    do_podpisu: { title: 'Brak umow do podpisu', desc: 'Zadna umowa nie oczekuje na podpis' },
    podpisane: { title: 'Brak podpisanych umow', desc: 'Nie ma jeszcze podpisanych umow' },
  };

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg p-4 overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Obieg umow</h1>
          <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
            Zarzadzaj umowami i sledz proces akceptacji
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-3 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg transition-colors font-medium text-sm"
        >
          <Upload className="w-4 h-4" />
          Dodaj umowe
        </button>
      </div>

      <div className="mb-4 flex bg-light-surface dark:bg-dark-surface rounded-xl border border-slate-200 dark:border-slate-700/50 p-1 gap-1">
        {tabs.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key;
          const count = counts[key];
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg font-medium transition-all text-sm relative ${
                isActive
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
              {count > 0 && (
                <span className={`min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold leading-none px-1 ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200 dark:bg-slate-600 text-text-secondary-light dark:text-text-secondary-dark'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
        </div>
      ) : contracts.length === 0 ? (
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-8 text-center">
          <FileText className="w-12 h-12 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-3" />
          <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
            {emptyMessages[activeTab].title}
          </h3>
          <p className="text-text-secondary-light dark:text-text-secondary-dark mb-4 text-sm">
            {emptyMessages[activeTab].desc}
          </p>
          {activeTab === 'robocze' && (
            <button
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg transition-colors font-medium text-sm"
            >
              <Upload className="w-4 h-4" />
              Dodaj umowe
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {contracts.map((contract) => (
            <div
              key={contract.id}
              onClick={() => onOpenContract(contract.id)}
              className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-3 hover:border-brand-primary/30 transition-all cursor-pointer group"
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
                      <span>Dzial: {contract.departments.name}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {activeTab === 'robocze' && contract.status === 'draft' && (
                    <>
                      <button
                        onClick={(e) => sendToApproval(e, contract.id)}
                        disabled={sendingId === contract.id}
                        className="flex items-center gap-1 px-2 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 text-xs font-medium"
                        title="Wyslij do akceptacji"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Do akceptacji</span>
                      </button>
                      <button
                        onClick={(e) => sendToSignature(e, contract.id)}
                        disabled={sendingId === contract.id}
                        className="flex items-center gap-1 px-2 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-lg transition-colors disabled:opacity-50 text-xs font-medium"
                        title="Wyslij do podpisu"
                      >
                        <FileSignature className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Do podpisu</span>
                      </button>
                    </>
                  )}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Eye className="w-4 h-4 text-brand-primary" />
                  </div>
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
            loadCounts();
          }}
        />
      )}
    </div>
  );
}
