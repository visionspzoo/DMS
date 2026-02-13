import { useState, useEffect } from 'react';
import { FileText, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';

type Invoice = Database['public']['Tables']['invoices']['Row'];

export function Dashboard() {
  const { profile } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;

    const fetchInvoices = async () => {
      try {
        const { data, error } = await supabase
          .from('invoices')
          .select('*')
          .or(`uploaded_by.eq.${profile.id},current_approver_id.eq.${profile.id}`)
          .order('created_at', { ascending: false });

        if (error) throw error;

        // Filter client-side to ensure only relevant invoices are shown
        // even if RLS allows seeing more (e.g., for admins)
        const filtered = (data || []).filter(invoice =>
          invoice.uploaded_by === profile.id ||
          invoice.current_approver_id === profile.id
        );

        setInvoices(filtered);
      } catch (error) {
        console.error('Error loading invoices:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInvoices();

    const subscription = supabase
      .channel('invoices-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        fetchInvoices();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [profile?.id]);

  const myInvoices = invoices.filter(i => i.uploaded_by === profile?.id);

  const myDraftInvoices = invoices.filter(i =>
    i.status === 'draft' && i.uploaded_by === profile?.id
  );

  const myInReviewInvoices = myInvoices.filter(i =>
    i.status === 'waiting' || i.status === 'pending' || i.status === 'in_review'
  );

  const waitingForMyApprovalInvoices = invoices.filter(i =>
    i.current_approver_id === profile?.id && (i.status === 'waiting' || i.status === 'pending')
  );

  const myRejectedInvoices = myInvoices.filter(i => i.status === 'rejected');

  const stats = {
    draft: myDraftInvoices.length,
    inReview: myInReviewInvoices.length,
    waiting: waitingForMyApprovalInvoices.length,
    rejected: myRejectedInvoices.length,
  };

  const draftInvoices = myDraftInvoices.slice(0, 5);
  const inReviewInvoices = myInReviewInvoices.slice(0, 5);
  const waitingInvoices = waitingForMyApprovalInvoices.slice(0, 5);
  const acceptedInvoices = myInvoices.filter(i => i.status === 'accepted').slice(0, 5);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg p-4 overflow-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Dashboard</h1>
        <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
          Przegląd systemu obiegu dokumentów
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {/* Draft Invoices */}
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-slate-500/10 dark:bg-slate-500/20 rounded-lg">
              <FileText className="w-4 h-4 text-slate-600 dark:text-slate-400" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase">
              Robocze
            </span>
          </div>
          <div className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark mb-0.5">
            {stats.draft}
          </div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Faktury robocze
          </p>
        </div>

        {/* In Review Invoices (my invoices) */}
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-brand-primary/10 dark:bg-brand-primary/20 rounded-lg">
              <FileText className="w-4 h-4 text-brand-primary" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase">
              W weryfikacji
            </span>
          </div>
          <div className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark mb-0.5">
            {stats.inReview}
          </div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Moje faktury w procesie
          </p>
        </div>

        {/* Waiting Invoices (others' invoices) */}
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-yellow-500/10 dark:bg-yellow-500/20 rounded-lg">
              <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase">
              Oczekujące
            </span>
          </div>
          <div className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark mb-0.5">
            {stats.waiting}
          </div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Do mojej weryfikacji
          </p>
        </div>

        {/* Rejected Invoices */}
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-status-error/10 dark:bg-status-error/20 rounded-lg">
              <XCircle className="w-4 h-4 text-status-error" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase">
              Odrzucone
            </span>
          </div>
          <div className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark mb-0.5">
            {stats.rejected}
          </div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Odrzucone faktury</p>
        </div>
      </div>


      {/* Draft Invoices Section */}
      <div className="mt-4 bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
        <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
          Faktury robocze
        </h3>
        <div className="space-y-2">
          {draftInvoices.length > 0 ? (
            draftInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-transparent hover:border-brand-primary/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                  <div>
                    <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                      {invoice.invoice_number || 'Brak numeru'}
                    </p>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {invoice.supplier_name || 'Brak dostawcy'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark font-mono">
                    {(invoice.gross_amount || 0).toLocaleString('pl-PL', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    {invoice.currency || 'PLN'}
                  </p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-slate-500/10 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400">
                    Robocza
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-text-secondary-light dark:text-text-secondary-dark py-4 text-sm">
              Brak faktur roboczych
            </p>
          )}
        </div>
      </div>

      {/* In Review Invoices Section (my invoices) */}
      <div className="mt-4 bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
        <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
          Moje faktury w weryfikacji
        </h3>
        <div className="space-y-2">
          {inReviewInvoices.length > 0 ? (
            inReviewInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-transparent hover:border-brand-primary/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                  <div>
                    <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                      {invoice.invoice_number || 'Brak numeru'}
                    </p>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {invoice.supplier_name || 'Brak dostawcy'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark font-mono">
                    {(invoice.gross_amount || 0).toLocaleString('pl-PL', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    {invoice.currency || 'PLN'}
                  </p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-brand-primary/10 text-brand-primary dark:bg-brand-primary/20">
                    W weryfikacji
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-text-secondary-light dark:text-text-secondary-dark py-4 text-sm">
              Brak faktur w weryfikacji
            </p>
          )}
        </div>
      </div>

      {/* Waiting Invoices Section (others' invoices) */}
      <div className="mt-4 bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
        <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
          Faktury oczekujące na moją weryfikację
        </h3>
        <div className="space-y-2">
          {waitingInvoices.length > 0 ? (
            waitingInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-transparent hover:border-brand-primary/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                  <div>
                    <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                      {invoice.invoice_number || 'Brak numeru'}
                    </p>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {invoice.supplier_name || 'Brak dostawcy'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark font-mono">
                    {(invoice.gross_amount || 0).toLocaleString('pl-PL', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    {invoice.currency || 'PLN'}
                  </p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-yellow-500/10 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-400">
                    Oczekuje
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-text-secondary-light dark:text-text-secondary-dark py-4 text-sm">
              Brak faktur oczekujących na weryfikację
            </p>
          )}
        </div>
      </div>

      {/* Accepted Invoices Section */}
      <div className="mt-4 bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
        <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
          Ostatnie zaakceptowane faktury
        </h3>
        <div className="space-y-2">
          {acceptedInvoices.length > 0 ? (
            acceptedInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-transparent hover:border-brand-primary/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-status-success" />
                  <div>
                    <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                      {invoice.invoice_number || 'Brak numeru'}
                    </p>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {invoice.supplier_name || 'Brak dostawcy'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark font-mono">
                    {(invoice.gross_amount || 0).toLocaleString('pl-PL', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    {invoice.currency || 'PLN'}
                  </p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-status-success/10 text-status-success dark:bg-status-success/20">
                    Zaakceptowano
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-text-secondary-light dark:text-text-secondary-dark py-8">
              Brak zaakceptowanych faktur
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
