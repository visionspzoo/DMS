import { useState, useEffect } from 'react';
import { ArrowLeft, Clock, CheckCircle, XCircle, CreditCard, FileText, ExternalLink, MapPin, Zap, Package, Calendar, Building2, User, MessageSquare, ThumbsUp, ThumbsDown, Trash2, AlertTriangle, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { PurchaseRequestComments } from './PurchaseRequestComments';

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
  clickup_task_id: string | null;
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

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; pill: string; banner: string; dot: string }> = {
  pending: {
    icon: <Clock className="w-4 h-4" />,
    label: 'Oczekuje na akceptację',
    pill: 'text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50',
    banner: 'from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/10 border-amber-200 dark:border-amber-700/50',
    dot: 'bg-amber-400',
  },
  approved: {
    icon: <CheckCircle className="w-4 h-4" />,
    label: 'Zaakceptowany',
    pill: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50',
    banner: 'from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/10 border-emerald-200 dark:border-emerald-700/50',
    dot: 'bg-emerald-500',
  },
  rejected: {
    icon: <XCircle className="w-4 h-4" />,
    label: 'Odrzucony',
    pill: 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-700/50',
    banner: 'from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/10 border-red-200 dark:border-red-700/50',
    dot: 'bg-red-500',
  },
  paid: {
    icon: <CreditCard className="w-4 h-4" />,
    label: 'Opłacony',
    pill: 'text-sky-700 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-300 border border-sky-200 dark:border-sky-700/50',
    banner: 'from-sky-50 to-cyan-50 dark:from-sky-900/20 dark:to-cyan-900/10 border-sky-200 dark:border-sky-700/50',
    dot: 'bg-sky-500',
  },
};

const PRIORITY_CONFIG: Record<string, { style: string; label: string; dot: string }> = {
  niski:   { style: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300', label: 'Niski', dot: 'bg-emerald-400' },
  normalny:{ style: 'text-brand-primary bg-brand-primary/10 dark:bg-brand-primary/20', label: 'Normalny', dot: 'bg-brand-primary' },
  wysoki:  { style: 'text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300', label: 'Wysoki', dot: 'bg-amber-400' },
  pilny:   { style: 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-300', label: 'Pilny', dot: 'bg-red-500' },
};

function MetaItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-light-bg dark:bg-dark-bg border border-slate-100 dark:border-slate-700/40">
      <div className="mt-0.5 w-7 h-7 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant flex items-center justify-center flex-shrink-0 text-text-secondary-light dark:text-text-secondary-dark">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">{label}</p>
        <div className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{value}</div>
      </div>
    </div>
  );
}

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
  const [submitterName, setSubmitterName] = useState<string | null>(null);
  const [submitterEmail, setSubmitterEmail] = useState<string | null>(null);
  const [currentApproverName, setCurrentApproverName] = useState<string | null>(null);
  const [currentApproverRole, setCurrentApproverRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);

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

      const { data: submitterProfile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', req.user_id)
        .maybeSingle();
      setSubmitterName(submitterProfile?.full_name || null);
      setSubmitterEmail(submitterProfile?.email || null);

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
          .select('full_name, role')
          .eq('id', req.current_approver_id)
          .maybeSingle();
        setCurrentApproverName(approverProfile?.full_name || null);
        setCurrentApproverRole(approverProfile?.role || null);
      } else {
        setCurrentApproverName(null);
        setCurrentApproverRole(null);
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

  async function triggerClickUpTask(requestId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-clickup-task`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ purchase_request_id: requestId }),
        }
      );
    } catch (err) {
      console.error('ClickUp task creation error:', err);
    }
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

    if (action === 'approved' && data?.status === 'approved') {
      const { data: updated } = await supabase
        .from('purchase_requests')
        .select('clickup_task_id')
        .eq('id', request.id)
        .maybeSingle();
      if (!updated?.clickup_task_id) {
        triggerClickUpTask(request.id);
      }
    }
  }

  async function handleWithdraw() {
    if (!request) return;
    setActionLoading(true);
    setActionError(null);

    const { error } = await supabase
      .from('purchase_requests')
      .delete()
      .eq('id', request.id)
      .eq('user_id', profile?.id);

    setActionLoading(false);

    if (error) {
      setActionError(error.message || 'Wystąpił błąd podczas wycofywania wniosku');
      setShowWithdrawConfirm(false);
      return;
    }

    onBack();
  }

  const canApprove = isApprover && request?.current_approver_id === profile?.id && request?.status === 'pending';
  const canWithdraw = request?.user_id === profile?.id && (request?.status === 'pending' || request?.status === 'rejected');

  if (loading) {
    return (
      <div className="h-full bg-light-bg dark:bg-dark-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
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
  const priority = PRIORITY_CONFIG[request.priority] || PRIORITY_CONFIG.normalny;
  const isProforma = !!request.proforma_filename;
  const totalAmount = request.gross_amount * (request.quantity || 1);

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="w-full p-4 space-y-4">

        {/* Back button */}
        <button
          onClick={onBack}
          className="group inline-flex items-center gap-1.5 text-sm text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Powrót
        </button>

        {/* Hero card */}
        <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700/50 shadow-sm bg-light-surface dark:bg-dark-surface">
          {/* Coloured banner by status */}
          <div className={`px-5 pt-5 pb-4 bg-gradient-to-br ${status.banner} border-b border-slate-100 dark:border-slate-700/40`}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${status.pill}`}>
                {status.icon}
                {status.label}
              </span>
              <div className="flex items-center gap-2">
                {isProforma && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-sky-700 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-300 border border-sky-200 dark:border-sky-700/50">
                    <FileText className="w-3 h-3" />
                    Proforma
                  </span>
                )}
                {request.clickup_task_id && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50">
                    <CheckCircle className="w-3 h-3" />
                    Zadanie ClickUp
                  </span>
                )}
              </div>
            </div>

            <h1 className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark leading-snug">
              {request.description}
            </h1>

            {!isProforma && (
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-text-primary-light dark:text-text-primary-dark">
                  {totalAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-sm font-semibold text-text-secondary-light dark:text-text-secondary-dark">PLN</span>
                {request.quantity > 1 && (
                  <span className="ml-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    ({request.gross_amount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} × {request.quantity})
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Submitter + awaiting row */}
          <div className="px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-100 dark:border-slate-700/40 bg-light-surface dark:bg-dark-surface">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              <User className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Złożony przez</span>
              <span className="font-medium text-text-primary-light dark:text-text-primary-dark">
                {submitterName || submitterEmail || 'Nieznany'}
              </span>
              {submitterEmail && submitterName && (
                <span className="hidden sm:inline text-slate-400 dark:text-slate-500">({submitterEmail})</span>
              )}
            </div>
            {request.current_approver_id && request.status === 'pending' && (
              <>
                <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600 flex-shrink-0" />
                <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    {currentApproverRole === 'Dyrektor' ? 'Oczekuje na dyrektora' : currentApproverRole === 'Kierownik' ? 'Oczekuje na kierownika' : 'Oczekuje na'}:
                  </span>
                  <span className="font-semibold">{currentApproverName || 'Nieznany'}</span>
                </div>
              </>
            )}
          </div>

          {/* Meta grid */}
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <MetaItem
              icon={<Zap className="w-3.5 h-3.5" />}
              label="Priorytet"
              value={
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${priority.style}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${priority.dot}`} />
                  {priority.label}
                </span>
              }
            />
            {!isProforma && (
              <MetaItem
                icon={<Package className="w-3.5 h-3.5" />}
                label="Ilość"
                value={`${request.quantity} szt.`}
              />
            )}
            <MetaItem
              icon={<MapPin className="w-3.5 h-3.5" />}
              label="Dostawa"
              value={request.delivery_location}
            />
            {department && (
              <MetaItem
                icon={<Building2 className="w-3.5 h-3.5" />}
                label="Dział"
                value={department.name}
              />
            )}
            <MetaItem
              icon={<Calendar className="w-3.5 h-3.5" />}
              label="Data złożenia"
              value={new Date(request.created_at).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' })}
            />
          </div>

          {/* Link or proforma file */}
          {isProforma ? (
            <div className="mx-4 mb-4 flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800/30 text-sm text-sky-700 dark:text-sky-300">
              <FileText className="w-4 h-4 flex-shrink-0" />
              <span className="font-medium truncate">{request.proforma_filename}</span>
            </div>
          ) : request.link ? (
            <div className="mx-4 mb-4">
              <a
                href={request.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-brand-primary/20 dark:border-brand-primary/30 bg-brand-primary/5 dark:bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/10 dark:hover:bg-brand-primary/20 transition-colors"
              >
                <ExternalLink className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-medium truncate">{request.link}</span>
              </a>
            </div>
          ) : null}

          {/* Approver comment (final) */}
          {request.approver_comment && (
            <div className="mx-4 mb-4 flex gap-2.5 px-3 py-3 rounded-xl bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50">
              <MessageSquare className="w-4 h-4 flex-shrink-0 mt-0.5 text-text-secondary-light dark:text-text-secondary-dark" />
              <div>
                <p className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Komentarz decyzyjny</p>
                <p className="text-sm text-text-primary-light dark:text-text-primary-dark">{request.approver_comment}</p>
              </div>
            </div>
          )}
        </div>

        {/* Approval timeline */}
        {approvals.length > 0 && (
          <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700/50 shadow-sm bg-light-surface dark:bg-dark-surface">
            <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-700/40">
              <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">Historia akceptacji</h3>
            </div>
            <div className="p-4 space-y-0">
              {approvals.map((approval, idx) => {
                const isApproved = approval.action === 'approved';
                return (
                  <div key={approval.id} className="relative flex gap-3">
                    {/* Timeline line */}
                    {idx < approvals.length - 1 && (
                      <div className="absolute left-4 top-8 bottom-0 w-px bg-slate-100 dark:bg-slate-700/50" />
                    )}
                    <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                      isApproved
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    }`}>
                      {isApproved ? <ThumbsUp className="w-3.5 h-3.5" /> : <ThumbsDown className="w-3.5 h-3.5" />}
                    </div>
                    <div className={`flex-1 min-w-0 ${idx < approvals.length - 1 ? 'pb-4' : 'pb-1'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                          {approval.approver?.full_name || 'Nieznany'}
                        </span>
                        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0">
                          {new Date(approval.created_at).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                        <span className={`font-medium ${isApproved ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {isApproved ? 'Zaakceptował' : 'Odrzucił'}
                        </span>
                        {' · '}
                        {approval.role === 'Kierownik' ? 'Kierownik' : approval.role === 'Dyrektor' ? 'Dyrektor' : approval.role}
                      </p>
                      {approval.comment && (
                        <div className="mt-1.5 px-3 py-2 rounded-lg bg-light-bg dark:bg-dark-bg border border-slate-100 dark:border-slate-700/40 text-xs text-text-primary-light dark:text-text-primary-dark italic">
                          "{approval.comment}"
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Comments */}
        <div>
          <PurchaseRequestComments requestId={requestId} />
        </div>

        {/* Approver action panel */}
        {canApprove && (
          <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700/50 shadow-sm bg-light-surface dark:bg-dark-surface">
            <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-700/40 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">Twoja decyzja</h3>
            </div>
            <div className="p-4 space-y-3">
              {actionError && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
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
                    className="w-full px-3 py-2.5 rounded-xl border border-red-200 dark:border-red-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-red-500/30 resize-none transition-colors"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction('rejected')}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-all disabled:opacity-60 shadow-sm"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      {actionLoading ? 'Przetwarzanie...' : 'Odrzuc wniosek'}
                    </button>
                    <button
                      onClick={() => { setShowRejectForm(false); setComment(''); }}
                      className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/50 text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant text-sm transition-all"
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
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary resize-none transition-colors"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction('approved')}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-all disabled:opacity-60 shadow-sm"
                    >
                      <ThumbsUp className="w-4 h-4" />
                      {actionLoading ? 'Przetwarzanie...' : 'Zaakceptuj wniosek'}
                    </button>
                    <button
                      onClick={() => setShowRejectForm(true)}
                      disabled={actionLoading}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-semibold text-sm transition-all disabled:opacity-60"
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

        {/* Withdraw panel */}
        {canWithdraw && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700/50 bg-light-surface dark:bg-dark-surface overflow-hidden shadow-sm">
            <div className="p-4">
              {actionError && !canApprove && (
                <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {actionError}
                </div>
              )}
              {showWithdrawConfirm ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 px-3 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                    <p className="text-sm text-red-800 dark:text-red-300">
                      Czy na pewno chcesz wycofać ten wniosek? Operacja jest nieodwracalna.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleWithdraw}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-all disabled:opacity-60 shadow-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                      {actionLoading ? 'Wycofywanie...' : 'Tak, wycofaj wniosek'}
                    </button>
                    <button
                      onClick={() => setShowWithdrawConfirm(false)}
                      disabled={actionLoading}
                      className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/50 text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant text-sm transition-all"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowWithdrawConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-semibold text-sm transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  Wycofaj wniosek
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
