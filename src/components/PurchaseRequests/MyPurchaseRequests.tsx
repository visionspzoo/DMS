import { useState, useEffect } from 'react';
import { Clock, CheckCircle, XCircle, ExternalLink, MapPin, Zap, Package, Calendar } from 'lucide-react';
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
}

const PRIORITY_STYLES: Record<string, string> = {
  niski: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
  normalny: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400',
  wysoki: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
  pilny: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400',
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
    style: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
  },
  approved: {
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    label: 'Zaakceptowany',
    style: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
  },
  rejected: {
    icon: <XCircle className="w-3.5 h-3.5" />,
    label: 'Odrzucony',
    style: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400',
  },
};

function RequestCard({ request }: { request: PurchaseRequest }) {
  const status = STATUS_CONFIG[request.status] || STATUS_CONFIG.pending;
  const priorityStyle = PRIORITY_STYLES[request.priority] || PRIORITY_STYLES.normalny;
  const priorityLabel = PRIORITY_LABELS[request.priority] || request.priority;

  const date = new Date(request.created_at).toLocaleDateString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  return (
    <div className="bg-white dark:bg-dark-card border border-border-light dark:border-border-dark rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark line-clamp-2 flex-1">
          {request.description}
        </p>
        <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${status.style}`}>
          {status.icon}
          {status.label}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <a
          href={request.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-brand-primary hover:underline truncate max-w-xs"
        >
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{request.link}</span>
        </a>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Kwota brutto</p>
          <p className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">
            {(request.gross_amount * request.quantity).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN
          </p>
          {request.quantity > 1 && (
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {request.gross_amount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} × {request.quantity}
            </p>
          )}
        </div>

        <div className="flex items-start gap-1.5">
          <Package className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Ilość</p>
            <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{request.quantity} szt.</p>
          </div>
        </div>

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

      <div className="mt-3 pt-3 border-t border-border-light dark:border-border-dark flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
        <Calendar className="w-3.5 h-3.5" />
        Złożony {date}
      </div>
    </div>
  );
}

export function MyPurchaseRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

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
  };

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">Moje wnioski zakupowe</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-1">
            Historia Twoich wniosków zakupowych.
          </p>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {(['all', 'pending', 'approved', 'rejected'] as const).map(f => {
            const labels = { all: 'Wszystkie', pending: 'Oczekujące', approved: 'Zaakceptowane', rejected: 'Odrzucone' };
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  filter === f
                    ? 'bg-brand-primary text-white'
                    : 'bg-white dark:bg-dark-card border border-border-light dark:border-border-dark text-text-secondary-light dark:text-text-secondary-dark hover:border-brand-primary hover:text-brand-primary'
                }`}
              >
                {labels[f]} ({counts[f]})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin w-6 h-6 text-brand-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-text-secondary-light dark:text-text-secondary-dark">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Brak wniosków zakupowych</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(r => <RequestCard key={r.id} request={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}
