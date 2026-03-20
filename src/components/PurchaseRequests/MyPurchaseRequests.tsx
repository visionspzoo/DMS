import { useState, useEffect } from 'react';
import { Clock, CheckCircle, XCircle, MapPin, Zap, Package, Calendar, CreditCard, FileText, ChevronRight, User, Inbox, Building2, Search, X, ChevronLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { PurchaseRequestDetail } from './PurchaseRequestDetail';
import { PurchaseRequestForm } from './PurchaseRequestForm';

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
  clickup_task_id?: string | null;
  paid_at?: string | null;
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
  waiting_for_manager: boolean | null;
}

interface Department {
  id: string;
  name: string;
}

const PAGE_SIZE = 30;

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

const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

function MyRequestCard({
  request,
  submitterName,
  submitterEmail,
  approverName,
  step,
  departmentName,
  onClick,
}: {
  request: PurchaseRequest;
  submitterName?: string | null;
  submitterEmail?: string | null;
  approverName?: string | null;
  step?: string | null;
  departmentName?: string | null;
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
  const submitter = submitterName || submitterEmail;
  const waitingOn = request.status === 'pending' && request.current_approver_id && approverName
    ? approverName
    : request.status === 'approved'
    ? 'Płatność'
    : null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 hover:border-brand-primary dark:hover:border-brand-primary transition-all group px-3 py-2.5"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {isProforma && (
              <span className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400">
                <FileText className="w-3 h-3" />
                PF
              </span>
            )}
            <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark truncate">
              {request.description}
            </span>
          </div>

          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              <Calendar className="w-3 h-3 flex-shrink-0" />
              {date}
            </span>

            {departmentName && (
              <span className="flex items-center gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                <Building2 className="w-3 h-3 flex-shrink-0" />
                <span className="truncate max-w-[120px]">{departmentName}</span>
              </span>
            )}

            {submitter && (
              <span className="flex items-center gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                <User className="w-3 h-3 flex-shrink-0" />
                <span className="truncate max-w-[120px]">{submitter}</span>
              </span>
            )}

            {waitingOn && (
              <span className={`flex items-center gap-1 text-xs font-medium ${request.status === 'approved' ? 'text-sky-600 dark:text-sky-400' : 'text-amber-600 dark:text-amber-400'}`}>
                <Clock className="w-3 h-3 flex-shrink-0" />
                Oczekuje: {waitingOn}
              </span>
            )}

            {step && (
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{step}</span>
              </span>
            )}

            {request.status === 'paid' && request.paid_at && (
              <span className="flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400">
                <CreditCard className="w-3 h-3 flex-shrink-0" />
                {new Date(request.paid_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                {' '}
                {new Date(request.paid_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}

            {request.clickup_task_id && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/50 flex-shrink-0">
                <CheckCircle className="w-2.5 h-2.5" />
                ClickUp
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 self-center">
          <span className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark whitespace-nowrap">
            {isProforma ? '—' : `${totalAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN`}
          </span>

          <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${priorityStyle}`}>
            {priorityLabel}
          </span>

          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${status.style}`}>
            {status.icon}
            <span className="hidden sm:inline">{status.label}</span>
          </span>

          <ChevronRight className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark group-hover:text-brand-primary transition-colors" />
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
          {approverRole === 'Dyrektor' && !request.waiting_for_manager && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-slate-500 bg-slate-100 dark:bg-slate-700/50 dark:text-slate-400">
              Krok 2/2
            </span>
          )}
          {request.waiting_for_manager ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-slate-500 bg-slate-100 dark:bg-slate-700/50 dark:text-slate-400">
              <Clock className="w-3 h-3" />
              U kierownika
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400">
              <Clock className="w-3 h-3" />
              Do akceptacji
            </span>
          )}
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

interface CountsState {
  all: number;
  pending: number;
  approved: number;
  rejected: number;
  paid: number;
}

const filterStore: {
  filter: FilterTab;
  search: string;
  searchInput: string;
  deptFilter: string;
  monthFilter: string;
  yearFilter: string;
  page: number;
  ownerOnly: boolean;
} = {
  filter: 'all',
  search: '',
  searchInput: '',
  deptFilter: '',
  monthFilter: '',
  yearFilter: '',
  page: 1,
  ownerOnly: false,
};

export function MyPurchaseRequests() {
  const { user, profile } = useAuth();
  const [myRequests, setMyRequests] = useState<PurchaseRequest[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [counts, setCounts] = useState<CountsState>({ all: 0, pending: 0, approved: 0, rejected: 0, paid: 0 });
  const [toApprove, setToApprove] = useState<PendingApproval[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [submitters, setSubmitters] = useState<Record<string, { full_name: string; email: string }>>({});
  const [approverNames, setApproverNames] = useState<Record<string, string>>({});
  const [departmentMap, setDepartmentMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilterState] = useState<FilterTab>(filterStore.filter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isApproverView, setIsApproverView] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [searchInput, setSearchInputState] = useState(filterStore.searchInput);
  const [search, setSearchState] = useState(filterStore.search);
  const [deptFilter, setDeptFilterState] = useState(filterStore.deptFilter);
  const [monthFilter, setMonthFilterState] = useState(filterStore.monthFilter);
  const [yearFilter, setYearFilterState] = useState(filterStore.yearFilter);
  const [page, setPageState] = useState(filterStore.page);
  const [ownerOnly, setOwnerOnlyState] = useState(filterStore.ownerOnly);

  function setFilter(v: FilterTab) { filterStore.filter = v; setFilterState(v); }
  function setSearchInput(v: string) { filterStore.searchInput = v; setSearchInputState(v); }
  function applySearch() {
    const val = filterStore.searchInput;
    filterStore.search = val;
    setSearchState(val);
    filterStore.page = 1;
    setPageState(1);
  }
  function clearSearch() {
    filterStore.searchInput = '';
    filterStore.search = '';
    setSearchInputState('');
    setSearchState('');
    filterStore.page = 1;
    setPageState(1);
  }
  function setDeptFilter(v: string) { filterStore.deptFilter = v; setDeptFilterState(v); filterStore.page = 1; setPageState(1); }
  function setMonthFilter(v: string) { filterStore.monthFilter = v; setMonthFilterState(v); filterStore.page = 1; setPageState(1); }
  function setYearFilter(v: string) { filterStore.yearFilter = v; setYearFilterState(v); filterStore.page = 1; setPageState(1); }
  function setOwnerOnly(v: boolean) { filterStore.ownerOnly = v; setOwnerOnlyState(v); filterStore.page = 1; setPageState(1); }
  function setPage(v: number | ((p: number) => number)) {
    const next = typeof v === 'function' ? v(filterStore.page) : v;
    filterStore.page = next;
    setPageState(next);
  }

  const isManagerOrDirector = profile?.role === 'Kierownik' || profile?.role === 'Dyrektor' || profile?.is_admin;

  useEffect(() => {
    if (!user || !profile) return;
    loadStaticData(profile.role === 'Kierownik' || profile.role === 'Dyrektor' || !!profile.is_admin);
  }, [user, profile?.id, profile?.role, profile?.is_admin]);

  useEffect(() => {
    if (!user || !profile) return;
    loadPage();
  }, [user, profile?.id, filter, search, deptFilter, monthFilter, yearFilter, ownerOnly, page]);

  async function loadStaticData(canApprove: boolean) {
    const [approveRes, deptRes, yearsRes] = await Promise.all([
      canApprove
        ? supabase.rpc('get_purchase_requests_for_approval')
        : Promise.resolve({ data: [], error: null }),
      supabase.from('departments').select('id, name').order('name'),
      supabase.from('purchase_requests').select('created_at').order('created_at', { ascending: true }),
    ]);

    if (!approveRes.error && approveRes.data) {
      setToApprove(approveRes.data as PendingApproval[]);
    }

    if (!deptRes.error && deptRes.data) {
      setDepartments(deptRes.data);
      setDepartmentMap(Object.fromEntries(deptRes.data.map((d: Department) => [d.id, d.name])));
    }

    if (!yearsRes.error && yearsRes.data) {
      const years = [...new Set(yearsRes.data.map((r: { created_at: string }) => new Date(r.created_at).getFullYear()))].sort((a, b) => b - a);
      setAvailableYears(years);
    }

    await loadCounts();
  }

  async function loadCounts() {
    const statuses: FilterTab[] = ['all', 'pending', 'approved', 'rejected', 'paid'];
    const results = await Promise.all(
      statuses.map(s => {
        let q = supabase.from('purchase_requests').select('id', { count: 'exact', head: true });
        if (s !== 'all') q = q.eq('status', s);
        return q;
      })
    );
    setCounts({
      all: results[0].count ?? 0,
      pending: results[1].count ?? 0,
      approved: results[2].count ?? 0,
      rejected: results[3].count ?? 0,
      paid: results[4].count ?? 0,
    });
  }

  async function loadPage() {
    setLoading(true);

    let query = supabase.from('purchase_requests').select('*', { count: 'exact' });

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    if (ownerOnly && profile) {
      query = query.or(`user_id.eq.${profile.id},current_approver_id.eq.${profile.id}`);
    }

    if (search.trim()) {
      query = query.or(`description.ilike.%${search.trim()}%,delivery_location.ilike.%${search.trim()}%`);
    }

    if (deptFilter) {
      query = query.eq('department_id', deptFilter);
    }

    if (yearFilter) {
      const y = parseInt(yearFilter);
      query = query.gte('created_at', `${y}-01-01`).lt('created_at', `${y + 1}-01-01`);
    }

    if (monthFilter && yearFilter) {
      const y = parseInt(yearFilter);
      const m = parseInt(monthFilter);
      const start = new Date(y, m - 1, 1).toISOString();
      const end = new Date(y, m, 1).toISOString();
      query = query.gte('created_at', start).lt('created_at', end);
    } else if (monthFilter && !yearFilter) {
      const m = parseInt(monthFilter).toString().padStart(2, '0');
      query = query.like('created_at', `%-${m}-%`);
    }

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to);

    if (!error && data) {
      setMyRequests(data);
      setTotalCount(count ?? 0);

      const profileIds = [
        ...new Set([
          ...data.map((r: PurchaseRequest) => r.user_id),
          ...data.filter((r: PurchaseRequest) => r.current_approver_id).map((r: PurchaseRequest) => r.current_approver_id as string),
        ]),
      ];
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', profileIds);
        if (profiles) {
          setSubmitters(prev => ({ ...prev, ...Object.fromEntries(profiles.map(p => [p.id, { full_name: p.full_name, email: p.email }])) }));
          setApproverNames(prev => ({ ...prev, ...Object.fromEntries(profiles.map(p => [p.id, p.full_name || p.email || ''])) }));
        }
      }
    }

    setLoading(false);
  }

  async function refreshAll() {
    await Promise.all([
      loadPage(),
      loadCounts(),
      isManagerOrDirector
        ? supabase.rpc('get_purchase_requests_for_approval').then(({ data }) => {
            if (data) setToApprove(data as PendingApproval[]);
          })
        : Promise.resolve(),
    ]);
  }

  function openRequest(id: string, asApprover: boolean) {
    setSelectedId(id);
    setIsApproverView(asApprover);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'Wszystkie' },
    { key: 'pending', label: 'Oczekujące' },
    { key: 'approved', label: 'Zaakceptowane' },
    { key: 'paid', label: 'Opłacone' },
    { key: 'rejected', label: 'Odrzucone' },
  ];

  const showApprovalSection = isManagerOrDirector && (filter === 'all' || filter === 'pending') && toApprove.length > 0;

  const hasActiveFilters = search.trim() || deptFilter || monthFilter || yearFilter || ownerOnly;

  function clearFilters() {
    filterStore.searchInput = '';
    filterStore.search = '';
    setSearchInputState('');
    setSearchState('');
    filterStore.deptFilter = '';
    setDeptFilterState('');
    filterStore.monthFilter = '';
    setMonthFilterState('');
    filterStore.yearFilter = '';
    setYearFilterState('');
    filterStore.ownerOnly = false;
    setOwnerOnlyState(false);
    filterStore.page = 1;
    setPageState(1);
  }

  if (editingId) {
    return (
      <PurchaseRequestForm
        editRequestId={editingId}
        onEditComplete={() => {
          setEditingId(null);
          refreshAll();
        }}
      />
    );
  }

  if (selectedId) {
    return (
      <PurchaseRequestDetail
        requestId={selectedId}
        onBack={() => {
          setSelectedId(null);
          setIsApproverView(false);
          refreshAll();
        }}
        isApprover={isApproverView}
        onEdit={(id) => {
          setSelectedId(null);
          setEditingId(id);
        }}
      />
    );
  }

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="p-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Moje wnioski zakupowe</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
            Historia Twoich wniosków oraz wnioski oczekujące na Twoją decyzję.
          </p>
        </div>

        {/* Status tabs */}
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">Status:</label>
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  filter === key
                    ? 'bg-brand-primary text-white'
                    : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
                }`}
              >
                {label}
                {key === 'pending' && toApprove.length > 0
                  ? ` (${counts[key] + toApprove.length})`
                  : ` (${counts[key]})`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-3">
            <label className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">Filtry:</label>

            {departments.length > 0 && (
              <>
                <label className="text-xs text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">Działy:</label>
                {departments.map(d => (
                  <button
                    key={d.id}
                    onClick={() => setDeptFilter(prev => prev === d.id ? '' : d.id)}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                      deptFilter === d.id
                        ? 'bg-brand-primary text-white'
                        : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
                    }`}
                  >
                    {d.name}
                  </button>
                ))}
                <div className="h-4 w-px bg-slate-300 dark:bg-slate-600 mx-1" />
              </>
            )}

            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Rok:</label>
              <select
                value={yearFilter}
                onChange={e => setYearFilter(e.target.value)}
                className="px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark"
              >
                <option value="">Wszystkie</option>
                {availableYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Miesiąc:</label>
              <select
                value={monthFilter}
                onChange={e => setMonthFilter(e.target.value)}
                className="px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark"
              >
                <option value="">Wszystkie</option>
                {MONTH_NAMES.map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>

            <div className="h-4 w-px bg-slate-300 dark:bg-slate-600 mx-1" />

            <button
              onClick={() => setOwnerOnly(!ownerOnly)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                ownerOnly
                  ? 'bg-sky-600 text-white'
                  : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
              }`}
            >
              <User className="w-3 h-3" />
              Właściciel
            </button>

            {hasActiveFilters && (
              <>
                <div className="h-4 w-px bg-slate-300 dark:bg-slate-600 mx-1" />
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-600 dark:text-red-400 bg-light-surface-variant dark:bg-dark-surface-variant hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Wyczyść filtry
                </button>
              </>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3 mb-4">
          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applySearch(); }}
                placeholder="Szukaj po opisie lub miejscu dostawy... (Enter aby szukać)"
                className="w-full pl-10 pr-8 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
              />
              {searchInput && (
                <button
                  onClick={clearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-text-secondary-light dark:text-text-secondary-dark transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              onClick={applySearch}
              className="px-3 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-brand-primary/90 transition-colors flex-shrink-0"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
          {search && search !== searchInput && (
            <p className="mt-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Wyniki dla: <span className="font-medium text-brand-primary">"{search}"</span>
            </p>
          )}
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
                {myRequests.length > 0 && (
                  <div className="flex items-center gap-2 mt-4 mb-1">
                    <h2 className="text-sm font-semibold text-text-secondary-light dark:text-text-secondary-dark">
                      Moje wnioski
                    </h2>
                  </div>
                )}
              </>
            )}

            {myRequests.length === 0 && !showApprovalSection ? (
              <div className="text-center py-20">
                {hasActiveFilters ? (
                  <>
                    <Search className="w-10 h-10 mx-auto mb-3 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
                    <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Brak wyników dla podanych filtrów</p>
                    <button
                      onClick={clearFilters}
                      className="mt-3 text-xs text-brand-primary hover:underline"
                    >
                      Wyczyść filtry
                    </button>
                  </>
                ) : (
                  <>
                    <Package className="w-10 h-10 mx-auto mb-3 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
                    <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Brak wniosków zakupowych</p>
                  </>
                )}
              </div>
            ) : myRequests.length === 0 && showApprovalSection ? null : (
              myRequests.map(r => (
                <MyRequestCard
                  key={r.id}
                  request={r}
                  submitterName={submitters[r.user_id]?.full_name}
                  submitterEmail={submitters[r.user_id]?.email}
                  approverName={r.current_approver_id ? approverNames[r.current_approver_id] : null}
                  departmentName={r.department_id ? departmentMap[r.department_id] : null}
                  onClick={() => openRequest(r.id, false)}
                />
              ))
            )}

            {!loading && totalCount === 0 && !showApprovalSection && filter !== 'all' && !hasActiveFilters && (
              <div className="text-center py-20">
                <Inbox className="w-10 h-10 mx-auto mb-3 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Brak wniosków w tej kategorii</p>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700/50 mt-2">
                <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                  {totalCount} wyników · strona {page} z {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (page <= 3) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = page - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`w-7 h-7 text-xs rounded-lg font-medium transition-colors ${
                          page === pageNum
                            ? 'bg-brand-primary text-white'
                            : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-lg text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
