import { useState, useEffect } from 'react';
import { ArrowLeft, Clock, CheckCircle, XCircle, CreditCard, FileText, ExternalLink, MapPin, Zap, Package, Calendar, Building2, User, MessageSquare, ThumbsUp, ThumbsDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface PurchaseRequest {
  id: string;
  user_id: string;
  link: string;
  gross_amount: number;
  description: string;
  quantity: number;
  delivery_location: string;
  priority: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  approver_comment: string | null;
  current_approver_id: string | null;
  department_id: string | null;
  proforma_filename: string | null;
}

interface Approval {
  id: string;
  approver_id: string;
  role: string;
  action: string;
  comment: string | null;
  created_at: string;
  approver?: { full_name: string; email: string };
}

interface Department {
  id: string;
  name: string;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; style: string }> = {
  pending: { icon: <Clock className="w-4 h-4" />, label: 'Oczekuje na akceptację', style: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-700/50' },
  approved: { icon: <CheckCircle className="w-4 h-4" />, label: 'Zaakceptowany', style: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/50' },
  rejected: { icon: <XCircle className="w-4 h-4" />, label: 'Odrzucony', style: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-700/50' },
  paid: { icon: <CreditCard className="w-4 h-4" />, label: 'Opłacony', style: 'text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400 border-sky-200 dark:border-sky-700/50' },
};

const PRIORITY_STYLES: Record<string, string> = {
  niski: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  normalny: 'text-brand-primary bg-brand-primary/10 dark:bg-brand-primary/20',
  wysoki: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400',
  pilny: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
};

const PRIORITY_LABELS: Record<string, string> = {
  niski: 'Niski', normalny: 'Normalny', wysoki: 'Wysoki', pilny: 'Pilny',
};

export function PurchaseRequestDetail({
  requestId,
  onBack,
  isApprover = false,
}: {
  requestId: string;
  onBack: () => void;
  isApprover?: boolean;
}) {
  const { profile } = useAuth();
  const [request, setRequest] = useState<PurchaseRequest | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [department, setDepartment] = useState<Department | null>(null);
  const [currentApproverName, setCurrentApproverName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    loadRequest();
  }, [requestId]);

  async function loadRequest() {
    setLoading(true);
    const { data: req } = await supabase
      .from('purchase_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (req) {
      setRequest(req);
      if (req.department_id) {
        const { data: dept } = await supabase
          .from('departments')
          .select('id, name')
          .eq('id', req.department_id)
          .maybeSingle();
        setDepartment(dept);
      }
      if (req.current_approver_id) {
        const { data: approverProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', req.current_approver_id)
          .maybeSingle();
        setCurrentApproverName(approverProfile?.full_name || null);
      }
    }

    const { data: approvalsData } = await supabase
      .from('purchase_request_approvals')
      .select('*')
      .eq('purchase_request_id', requestId)
      .order('created_at', { ascending: true });

    if (approvalsData && approvalsData.length > 0) {
      const approverIds = [...new Set(approvalsData.map(a => a.approver_id))];
      const { data: approverProfiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', approverIds);

      const profileMap = Object.fromEntries((approverProfiles || []).map(p => [p.id, p]));
      setApprovals(approvalsData.map(a => ({ ...a, approver: profileMap[a.approver_id] })));
    }

    setLoading(false);
  }

  async function handleAction(action: 'approved' | 'rejected') {
    if (!request) return;
    setActionLoading(true);
    setActionError(null);

    const { data, error } = await supabase.rpc('process_purchase_request_approval', {
      p_request_id: request.id,
      p_action: action,
      p_comment: comment || null,
    });

    setActionLoading(false);

    if (error || !data?.success) {
      setActionError(error?.message || data?.error || 'Wystąpił błąd');
      return;
    }

    setComment('');
    setShowRejectForm(false);
    await loadRequest();
  }

  const canApprove = isApprover && request?.current_approver_id === profile?.id && request?.status === 'pending';

  if (loading) {
    return (
      <div className="h-full bg-light-bg dark:bg-dark-bg flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="h-full bg-light-bg dark:bg-dark-bg flex items-center justify-center">
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Nie znaleziono wniosku</p>
      </div>
    );
  }

  const status = STATUS_CONFIG[request.status] || STATUS_CONFIG.pending;
  const priorityStyle = PRIORITY_STYLES[request.priority] || PRIORITY_STYLES.normalny;
  const priorityLabel = PRIORITY_LABELS[request.priority] || request.priority;
  const isProforma = !!request.proforma_filename;
  const totalAmount = request.gross_amount * (request.quantity || 1);

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="p-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Powrót
        </button>

        {/* Header */}
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden mb-4">
          <div className="px-4 py-4 border-b border-slate-200 dark:border-slate-700/50">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {isProforma && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400 flex-shrink-0">
                    <FileText className="w-3 h-3" />
                    Proforma
                  </span>
                )}
                <h2 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark">
                  {request.description}
                </h2>
              </div>
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border flex-shrink-0 ${status.style}`}>
                {status.icon}
                {status.label}
              </span>
            </div>

            {request.current_approver_id && request.status === 'pending' && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                <User className="w-3.5 h-3.5" />
                Oczekuje na: <span className="font-medium text-text-primary-light dark:text-text-primary-dark">{currentApproverName || 'Nieznany'}</span>
              </div>
            )}
          </div>

          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Kwota brutto</p>
              <p className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">
                {isProforma ? 'Z proformy' : `${totalAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN`}
              </p>
              {!isProforma && request.quantity > 1 && (
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                  {request.gross_amount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} × {request.quantity}
                </p>
              )}
            </div>

            {!isProforma && (
              <div className="flex items-start gap-1.5">
                <Package className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5" />
                <div>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Ilość</p>
                  <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{request.quantity} szt.</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5" />
              <div>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Dostawa</p>
                <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{request.delivery_location}</p>
              </div>
            </div>

            <div className="flex items-start gap-1.5">
              <Zap className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5" />
              <div>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Priorytet</p>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${priorityStyle}`}>{priorityLabel}</span>
              </div>
            </div>

            {department && (
              <div className="flex items-start gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5" />
                <div>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Dział</p>
                  <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{department.name}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5" />
              <div>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Data złożenia</p>
                <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                  {new Date(request.created_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </p>
              </div>
            </div>
          </div>

          {/* Link or proforma */}
          {isProforma ? (
            <div className="px-4 pb-4 flex items-center gap-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">
              <FileText className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{request.proforma_filename}</span>
            </div>
          ) : request.link ? (
            <div className="px-4 pb-4">
              <a
                href={request.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-brand-primary hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{request.link}</span>
              </a>
            </div>
          ) : null}

          {request.approver_comment && (
            <div className="mx-4 mb-4 px-3 py-2.5 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50">
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5 flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                Komentarz
              </p>
              <p className="text-sm text-text-primary-light dark:text-text-primary-dark">{request.approver_comment}</p>
            </div>
          )}
        </div>

        {/* Approval history */}
        {approvals.length > 0 && (
          <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 mb-4 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50">
              <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">Historia akceptacji</h3>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {approvals.map(approval => (
                <div key={approval.id} className="px-4 py-3 flex items-start gap-3">
                  <div className={`mt-0.5 flex-shrink-0 p-1 rounded-full ${approval.action === 'approved' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                    {approval.action === 'approved' ? <ThumbsUp className="w-3 h-3" /> : <ThumbsDown className="w-3 h-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                        {approval.approver?.full_name || 'Nieznany'}
                      </span>
                      <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0">
                        {new Date(approval.created_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {approval.role} · {approval.action === 'approved' ? 'Zaakceptował' : 'Odrzucił'}
                    </p>
                    {approval.comment && (
                      <p className="text-xs text-text-primary-light dark:text-text-primary-dark mt-1 italic">"{approval.comment}"</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Approver actions */}
        {canApprove && (
          <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50">
              <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">Twoja decyzja</h3>
            </div>
            <div className="p-4">
              {actionError && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400 text-sm">
                  {actionError}
                </div>
              )}

              {showRejectForm ? (
                <div className="space-y-3">
                  <textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="Podaj powód odrzucenia (opcjonalnie)..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 transition-colors resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction('rejected')}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-all disabled:opacity-60"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      Odrzuc wniosek
                    </button>
                    <button
                      onClick={() => { setShowRejectForm(false); setComment(''); }}
                      className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant text-sm transition-all"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="Komentarz do akceptacji (opcjonalnie)..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction('approved')}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-all disabled:opacity-60"
                    >
                      <ThumbsUp className="w-4 h-4" />
                      Zaakceptuj wniosek
                    </button>
                    <button
                      onClick={() => setShowRejectForm(true)}
                      disabled={actionLoading}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-semibold text-sm transition-all disabled:opacity-60"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      Odrzuc
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
