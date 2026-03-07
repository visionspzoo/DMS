import { useState, useEffect } from 'react';
import { Clock, CheckCircle, XCircle, ExternalLink, MapPin, Zap, Package, Calendar, CreditCard, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface PurchaseRequest {
  id: string;
  link: string;
  gross_amount: number;
  description: string;
  quantity: number;
  delivery_location: string;
  priority: string;
  status: string;
  created_at: string;
  proforma_filename?: string | null;
}

const PRIORITY_STYLES: Record<string, string> = {
  niski: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  normalny: 'text-brand-primary bg-brand-primary/10 dark:bg-brand-primary/20',
  wysoki: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400',
  pilny: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
};

const PRIORITY_LABELS: Record<string, string> = {
  niski: 'Niski',
  normalny: 'Normalny',
  wysoki: 'Wysoki',
  pilny: 'Pilny',
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

function RequestCard({ request }: { request: PurchaseRequest }) {
  const status = STATUS_CONFIG[request.status] || STATUS_CONFIG.pending;
  const priorityStyle = PRIORITY_STYLES[request.priority] || PRIORITY_STYLES.normalny;
  const priorityLabel = PRIORITY_LABELS[request.priority] || request.priority;
  const isProforma = !!request.proforma_filename;

  const date = new Date(request.created_at).toLocaleDateString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  const totalAmount = request.gross_amount * (request.quantity || 1);

  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isProforma && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400 flex-shrink-0">
              <FileText className="w-3 h-3" />
              Proforma
            </span>
          )}
          <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark line-clamp-1">
            {request.description}
          </p>
        </div>
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${status.style}`}>
          {status.icon}
          {status.label}
        </span>
      </div>

      <div className="p-4">
        {isProforma ? (
          <div className="flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark mb-4">
            <FileText className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{request.proforma_filename}</span>
          </div>
        ) : request.link ? (
          <a
            href={request.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-brand-primary hover:underline mb-4 max-w-sm"
          >
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{request.link}</span>
          </a>
        ) : null}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Kwota brutto</p>
            <p className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">
              {totalAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN
            </p>
            {request.quantity > 1 && (
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

        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700/50 flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          <Calendar className="w-3.5 h-3.5" />
          Złożony {date}
        </div>
      </div>
    </div>
  );
}

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected' | 'paid';

export function MyPurchaseRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');

  useEffect(() => {
    if (!user) return;
    loadRequests();
  }, [user]);

  async function loadRequests() {
    setLoading(true);
    const { data, error } = await supabase
      .from('purchase_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) setRequests(data);
    setLoading(false);
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);

  const counts = {
    all: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
    paid: requests.filter(r => r.status === 'paid').length,
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'Wszystkie' },
    { key: 'pending', label: 'Oczekujące' },
    { key: 'approved', label: 'Zaakceptowane' },
    { key: 'paid', label: 'Opłacone' },
    { key: 'rejected', label: 'Odrzucone' },
  ];

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="p-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Moje wnioski zakupowe</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
            Historia Twoich wniosków zakupowych.
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
              {label} ({counts[key]})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Package className="w-10 h-10 mx-auto mb-3 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Brak wniosków zakupowych</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => <RequestCard key={r.id} request={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}
