import { useState, useEffect } from 'react';
import { Clock, CheckCircle, XCircle, ExternalLink, MapPin, Zap, Package, Calendar, CreditCard, FileText, ChevronRight, User, Inbox, Building2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { PurchaseRequestDetail } from './PurchaseRequestDetail';

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
  current_approver_id?: string | null;
  approver_comment?: string | null;
  proforma_filename?: string | null;
  department_id?: string | null;
}

interface PendingApproval {
  id: string;
  user_id: string;
  submitter_name: string;
  submitter_email: string;
  department_id: string | null;
  department_name: string | null;
  link: string;
  gross_amount: number;
  description: string;
  quantity: number;
  delivery_location: string;
  priority: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
  proforma_filename: string | null;
  has_director: boolean | null;
}

const PRIORITY_STYLES: Record<string, string> = {
  niski: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  normalny: 'text-brand-primary bg-brand-primary/10 dark:bg-brand-primary/20',
  wysoki: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400',
  pilny: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
};

const PRIORITY_LABELS: Record<string, string> = {
  niski: 'Niski', normalny: 'Normalny', wysoki: 'Wysoki', pilny: 'Pilny',
};

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; style: string }> = {
  pending: {
    icon: <Clock className="w-3.5 h-3.5" />,
    label: 'Oczekuje',
    style: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400',
  },
  approved: {
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    label: 'Zaakceptowany',
    style: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  rejected: {
    icon: <XCircle className="w-3.5 h-3.5" />,
    label: 'Odrzucony',
    style: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
  },
  paid: {
    icon: <CreditCard className="w-3.5 h-3.5" />,
    label: 'Opłacony',
    style: 'text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400',
  },
};

function MyRequestCard({
  request,
  submitterName,
  submitterEmail,
  approverName,
  onClick,
}: {
  request: PurchaseRequest;
  submitterName?: string | null;
  submitterEmail?: string | null;
  approverName?: string | null;
  onClick: () => void;
}) {
  const status = STATUS_CONFIG[request.status] || STATUS_CONFIG.pending;
  const priorityStyle = PRIORITY_STYLES[request.priority] || PRIORITY_STYLES.normalny;
  const priorityLabel = PRIORITY_LABELS[request.priority] || request.priority;
  const isProforma = !!request.proforma_filename;
  const totalAmount = request.gross_amount * (request.quantity || 1);
  const date = new Date(request.created_at).toLocaleDateString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden hover:border-brand-primary dark:hover:border-brand-primary transition-all group"
    >
      <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isProforma && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400 flex-shrink-0">
              <FileText className="w-3 h-3" />
              Proforma
            </span>
          )}
          <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark truncate">
            {request.description}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${status.style}`}>
            {status.icon}
            {status.label}
          </span>
          <ChevronRight className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark group-hover:text-brand-primary transition-colors" />
        </div>
      </div>

      <div className="p-4">
        {(submitterName || submitterEmail) && (
          <div className="flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark mb-3">
            <User className="w-3 h-3 flex-shrink-0" />
            <span className="font-medium text-text-primary-light dark:text-text-primary-dark">{submitterName || submitterEmail}</span>
            {submitterEmail && submitterName && <span className="truncate">({submitterEmail})</span>}
          </div>
        )}

        {isProforma ? (
          <div className="flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark mb-3">
            <FileText className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{request.proforma_filename}</span>
          </div>
        ) : request.link ? (
          <div className="flex items-center gap-1.5 text-xs text-brand-primary mb-3 max-w-sm">
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{request.link}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              <Package className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Ilość</p>
                <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{request.quantity} szt.</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Dostawa</p>
              <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{request.delivery_location}</p>
            </div>
          </div>

          <div className="flex items-start gap-1.5">
            <Zap className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Priorytet</p>
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${priorityStyle}`}>
                {priorityLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700/50 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
            <Calendar className="w-3.5 h-3.5" />
            Złożony {date}
          </div>
          {request.status === 'pending' && request.current_approver_id && approverName && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <Clock className="w-3 h-3 flex-shrink-0" />
              Oczekuje na decyzję: {approverName}
            </span>
          )}
          {request.status === 'approved' && (
            <span className="flex items-center gap-1 text-xs text-sky-600 dark:text-sky-400 font-medium">
              <CreditCard className="w-3 h-3 flex-shrink-0" />
              Oczekuje na płatność
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ApprovalCard({
  request,
  approverRole,
  onClick,
}: {
  request: PendingApproval;
  approverRole: string;
  onClick: () => void;
}) {
  const priorityStyle = PRIORITY_STYLES[request.priority] || PRIORITY_STYLES.normalny;
  const priorityLabel = PRIORITY_LABELS[request.priority] || request.priority;
  const isProforma = !!request.proforma_filename;
  const date = request.submitted_at
    ? new Date(request.submitted_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date(request.created_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-amber-300 dark:border-amber-700/60 overflow-hidden hover:border-brand-primary dark:hover:border-brand-primary transition-all group"
    >
      <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-200 dark:border-amber-700/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isProforma && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400 flex-shrink-0">
              <FileText className="w-3 h-3" />
              Proforma
            </span>
          )}
          <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark truncate">
            {request.description}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {approverRole === 'Kierownik' && request.has_director && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-slate-500 bg-slate-100 dark:bg-slate-700/50 dark:text-slate-400">
              Krok 1/2
            </span>
          )}
          {approverRole === 'Dyrektor' && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-slate-500 bg-slate-100 dark:bg-slate-700/50 dark:text-slate-400">
              Krok 2/2
            </span>
          )}
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400">
            <Clock className="w-3 h-3" />
            Do akceptacji
          </span>
          <ChevronRight className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark group-hover:text-brand-primary transition-colors" />
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-1.5 mb-3 text-sm">
          <User className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0" />
          <span className="font-medium text-text-primary-light dark:text-text-primary-dark">{request.submitter_name || request.submitter_email}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Kwota</p>
            <p className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">
              {isProforma ? 'Z proformy' : `${(request.gross_amount * (request.quantity || 1)).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN`}
            </p>
          </div>

          {request.department_name && (
            <div className="flex items-start gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Dział</p>
                <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{request.department_name}</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Dostawa</p>
              <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{request.delivery_location}</p>
            </div>
          </div>

          <div className="flex items-start gap-1.5">
            <Zap className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Priorytet</p>
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${priorityStyle}`}>{priorityLabel}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700/50 flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          <Calendar className="w-3.5 h-3.5" />
          Złożony {date}
        </div>
      </div>
    </button>
  );
}

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected' | 'paid';

export function MyPurchaseRequests() {
  const { user, profile } = useAuth();
  const [myRequests, setMyRequests] = useState<PurchaseRequest[]>([]);
  const [toApprove, setToApprove] = useState<PendingApproval[]>([]);
  const [submitters, setSubmitters] = useState<Record<string, { full_name: string; email: string }>>({});
  const [approverNames, setApproverNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isApproverView, setIsApproverView] = useState(false);

  const isManagerOrDirector = profile?.role === 'Kierownik' || profile?.role === 'Dyrektor' || profile?.is_admin;

  useEffect(() => {
    if (!user) return;
    loadAll();
  }, [user]);

  async function loadAll() {
    setLoading(true);

    const [myRes, approveRes] = await Promise.all([
      supabase.from('purchase_requests').select('*').order('created_at', { ascending: false }),
      isManagerOrDirector
        ? supabase.rpc('get_purchase_requests_for_approval')
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (!myRes.error && myRes.data) {
      setMyRequests(myRes.data);
      const profileIds = [
        ...new Set([
          ...myRes.data.map((r: PurchaseRequest) => r.user_id),
          ...myRes.data.filter((r: PurchaseRequest) => r.current_approver_id).map((r: PurchaseRequest) => r.current_approver_id as string),
        ]),
      ];
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', profileIds);
        if (profiles) {
          setSubmitters(Object.fromEntries(profiles.map(p => [p.id, { full_name: p.full_name, email: p.email }])));
          setApproverNames(Object.fromEntries(profiles.map(p => [p.id, p.full_name || p.email || ''])));
        }
      }
    }

    if (!approveRes.error && approveRes.data) {
      setToApprove(approveRes.data as PendingApproval[]);
    }

    setLoading(false);
  }

  function openRequest(id: string, asApprover: boolean) {
    setSelectedId(id);
    setIsApproverView(asApprover);
  }

  if (selectedId) {
    return (
      <PurchaseRequestDetail
        requestId={selectedId}
        onBack={() => {
          setSelectedId(null);
          setIsApproverView(false);
          loadAll();
        }}
        isApprover={isApproverView}
      />
    );
  }

  const filteredMy = filter === 'all' ? myRequests : myRequests.filter(r => r.status === filter);

  const counts = {
    all: myRequests.length,
    pending: myRequests.filter(r => r.status === 'pending').length,
    approved: myRequests.filter(r => r.status === 'approved').length,
    rejected: myRequests.filter(r => r.status === 'rejected').length,
    paid: myRequests.filter(r => r.status === 'paid').length,
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'Wszystkie' },
    { key: 'pending', label: 'Oczekujące' },
    { key: 'approved', label: 'Zaakceptowane' },
    { key: 'paid', label: 'Opłacone' },
    { key: 'rejected', label: 'Odrzucone' },
  ];

  const showApprovalSection = isManagerOrDirector && (filter === 'all' || filter === 'pending') && toApprove.length > 0;

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="p-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Moje wnioski zakupowe</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
            Historia Twoich wniosków oraz wnioski oczekujące na Twoją decyzję.
          </p>
        </div>

        <div className="mb-4 flex items-center gap-1 bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-1 flex-wrap">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex-1 inline-flex items-center justify-center px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                filter === key
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
              }`}
            >
              {label}
              {key === 'pending' && toApprove.length > 0
                ? ` (${counts[key] + toApprove.length})`
                : ` (${counts[key]})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
          </div>
        ) : (
          <div className="space-y-3">
            {showApprovalSection && (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <h2 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                    Wymagają Twojej decyzji ({toApprove.length})
                  </h2>
                </div>
                {toApprove.map(req => (
                  <ApprovalCard
                    key={req.id}
                    request={req}
                    approverRole={profile?.role || ''}
                    onClick={() => openRequest(req.id, true)}
                  />
                ))}
                {filteredMy.length > 0 && (
                  <div className="flex items-center gap-2 mt-4 mb-1">
                    <h2 className="text-sm font-semibold text-text-secondary-light dark:text-text-secondary-dark">
                      Moje wnioski
                    </h2>
                  </div>
                )}
              </>
            )}

            {filteredMy.length === 0 && !showApprovalSection ? (
              <div className="text-center py-20">
                <Package className="w-10 h-10 mx-auto mb-3 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Brak wniosków zakupowych</p>
              </div>
            ) : filteredMy.length === 0 && showApprovalSection ? null : (
              filteredMy.map(r => (
                <MyRequestCard
                  key={r.id}
                  request={r}
                  submitterName={submitters[r.user_id]?.full_name}
                  submitterEmail={submitters[r.user_id]?.email}
                  approverName={r.current_approver_id ? approverNames[r.current_approver_id] : null}
                  onClick={() => openRequest(r.id, false)}
                />
              ))
            )}

            {!loading && filteredMy.length === 0 && !showApprovalSection && filter !== 'all' && (
              <div className="text-center py-20">
                <Inbox className="w-10 h-10 mx-auto mb-3 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Brak wniosków w tej kategorii</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
