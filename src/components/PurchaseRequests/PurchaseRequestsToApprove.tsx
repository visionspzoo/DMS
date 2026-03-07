import { useState, useEffect } from 'react';
import { Clock, FileText, ExternalLink, MapPin, Zap, Package, Calendar, Building2, User, ChevronRight, Inbox } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface PendingRequest {
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

export function PurchaseRequestsToApprove({ onSelect }: { onSelect: (id: string) => void }) {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_purchase_requests_for_approval');
    if (!error && data) setRequests(data);
    setLoading(false);
  }

  const isManagerOrDirector = profile?.role === 'Kierownik' || profile?.role === 'Dyrektor' || profile?.is_admin;

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="p-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Do akceptacji</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
            Wnioski zakupowe czekające na Twoją decyzję.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-20">
            <Inbox className="w-10 h-10 mx-auto mb-3 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
            <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">Brak wniosków do akceptacji</p>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">Wszystkie wnioski zostały rozpatrzone</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(req => {
              const priorityStyle = PRIORITY_STYLES[req.priority] || PRIORITY_STYLES.normalny;
              const priorityLabel = PRIORITY_LABELS[req.priority] || req.priority;
              const isProforma = !!req.proforma_filename;
              const date = req.submitted_at
                ? new Date(req.submitted_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : new Date(req.created_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });

              return (
                <button
                  key={req.id}
                  onClick={() => onSelect(req.id)}
                  className="w-full text-left bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden hover:border-brand-primary dark:hover:border-brand-primary transition-all group"
                >
                  <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {isProforma && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400 flex-shrink-0">
                          <FileText className="w-3 h-3" />
                          Proforma
                        </span>
                      )}
                      <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                        {req.description}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400">
                        <Clock className="w-3 h-3" />
                        Oczekuje
                      </span>
                      <ChevronRight className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark group-hover:text-brand-primary transition-colors" />
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="flex items-center gap-1.5 mb-3 text-sm">
                      <User className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0" />
                      <span className="font-medium text-text-primary-light dark:text-text-primary-dark">{req.submitter_name || req.submitter_email}</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Kwota</p>
                        <p className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">
                          {isProforma ? 'Z proformy' : `${(req.gross_amount * (req.quantity || 1)).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN`}
                        </p>
                      </div>

                      {req.department_name && (
                        <div className="flex items-start gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Dział</p>
                            <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{req.department_name}</p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Dostawa</p>
                          <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{req.delivery_location}</p>
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

                    <div className="mt-3 pt-3 border-t border-slate-200 dark:divide-slate-700/50 flex items-center gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      <Calendar className="w-3.5 h-3.5" />
                      Złożony {date}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
