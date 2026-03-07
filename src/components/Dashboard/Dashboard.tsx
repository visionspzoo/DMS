import { useState, useEffect } from 'react';
import { FileText, Clock, XCircle, ShoppingCart, Package } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';

type Invoice = Database['public']['Tables']['invoices']['Row'];

interface PurchaseRequest {
  id: string;
  description: string;
  gross_amount: number;
  quantity: number;
  priority: string;
  status: string;
  created_at: string;
  proforma_filename: string | null;
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  return (
    <div className="flex items-center justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-transparent hover:border-brand-primary/30 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="w-4 h-4 flex-shrink-0 text-text-secondary-light dark:text-text-secondary-dark" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark truncate">
            {invoice.invoice_number || 'Brak numeru'}
          </p>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark truncate">
            {invoice.supplier_name || 'Brak dostawcy'}
          </p>
        </div>
      </div>
      <div className="text-right flex-shrink-0 ml-2">
        <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark font-mono">
          {(invoice.gross_amount || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2 })}{' '}
          {invoice.currency || 'PLN'}
        </p>
      </div>
    </div>
  );
}

function PurchaseRequestRow({ req }: { req: PurchaseRequest }) {
  const isProforma = !!req.proforma_filename;
  const total = req.gross_amount * (req.quantity || 1);

  return (
    <div className="flex items-center justify-between p-2 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-transparent hover:border-brand-primary/30 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <ShoppingCart className="w-4 h-4 flex-shrink-0 text-text-secondary-light dark:text-text-secondary-dark" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark truncate">
            {req.description}
          </p>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {new Date(req.created_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="text-right flex-shrink-0 ml-2">
        <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark font-mono">
          {isProforma ? '—' : `${total.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN`}
        </p>
      </div>
    </div>
  );
}

function SectionBox({
  title,
  icon,
  iconBg,
  children,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  iconBg: string;
  children: React.ReactNode;
  emptyText: string;
}) {
  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-1.5 rounded-lg ${iconBg}`}>{icon}</div>
        <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function Dashboard() {
  const { profile } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [purchaseRequestsToApprove, setPurchaseRequestsToApprove] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const isManagerOrDirector = profile?.role === 'Kierownik' || profile?.role === 'Dyrektor' || profile?.is_admin;

  useEffect(() => {
    if (!profile?.id) return;
    fetchAll();

    const subscription = supabase
      .channel('dashboard-invoices-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invoices' }, () => fetchAll())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'invoices' }, (payload) => {
        const deletedId = (payload.old as any)?.id;
        if (deletedId) setInvoices(prev => prev.filter(inv => inv.id !== deletedId));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'invoices' }, async (payload) => {
        const updatedId = (payload.new as any)?.id;
        if (!updatedId) return;
        const { data } = await supabase
          .from('invoices')
          .select('id,invoice_number,supplier_name,issue_date,due_date,gross_amount,pln_gross_amount,currency,status,uploaded_by,current_approver_id,department_id,created_at,is_duplicate,duplicate_invoice_ids')
          .eq('id', updatedId)
          .maybeSingle();
        if (data) {
          setInvoices(prev => {
            const exists = prev.some(inv => inv.id === updatedId);
            if (!exists) return prev;
            return prev.map(inv => inv.id === updatedId ? data as any : inv);
          });
        }
      })
      .subscribe();

    return () => { subscription.unsubscribe(); };
  }, [profile?.id]);

  async function fetchAll() {
    try {
      let invoiceQuery = supabase
        .from('invoices')
        .select('id,invoice_number,supplier_name,issue_date,due_date,gross_amount,pln_gross_amount,currency,status,uploaded_by,current_approver_id,department_id,created_at,is_duplicate,duplicate_invoice_ids')
        .order('created_at', { ascending: false });

      const isManagerOrDirectorLocal = profile?.role === 'Kierownik' || profile?.role === 'Dyrektor';
      if (!isManagerOrDirectorLocal && !profile?.is_admin && profile?.role !== 'CEO') {
        if (profile?.department_id) {
          invoiceQuery = invoiceQuery.or(
            `uploaded_by.eq.${profile.id},current_approver_id.eq.${profile.id},department_id.eq.${profile.department_id}`
          );
        } else {
          invoiceQuery = invoiceQuery.or(
            `uploaded_by.eq.${profile?.id},current_approver_id.eq.${profile?.id}`
          );
        }
      }

      const [invoiceRes, prRes, prApproveRes] = await Promise.all([
        invoiceQuery,
        supabase
          .from('purchase_requests')
          .select('id,description,gross_amount,quantity,priority,status,created_at,proforma_filename')
          .order('created_at', { ascending: false }),
        isManagerOrDirector
          ? supabase.rpc('get_purchase_requests_for_approval')
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!invoiceRes.error) setInvoices(invoiceRes.data || []);
      if (!prRes.error) setPurchaseRequests(prRes.data || []);
      if (!prApproveRes.error) setPurchaseRequestsToApprove((prApproveRes.data || []) as PurchaseRequest[]);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  const myDraftInvoices = invoices.filter(i => i.status === 'draft').slice(0, 5);

  const waitingForMyApprovalInvoices = invoices.filter(i =>
    i.current_approver_id === profile?.id && (i.status === 'waiting' || i.status === 'pending')
  ).slice(0, 5);

  const rejectedInvoices = invoices.filter(i =>
    i.status === 'rejected' && (
      i.uploaded_by === profile?.id ||
      i.current_approver_id === profile?.id ||
      i.department_id === profile?.department_id
    )
  ).slice(0, 5);

  const rejectedPurchaseRequests = purchaseRequests
    .filter(r => r.status === 'rejected')
    .slice(0, 5);

  const prToApprove = purchaseRequestsToApprove.slice(0, 5);

  const stats = {
    draft: invoices.filter(i => i.status === 'draft').length,
    waiting: invoices.filter(i => i.current_approver_id === profile?.id && (i.status === 'waiting' || i.status === 'pending')).length,
    rejected: invoices.filter(i => i.status === 'rejected' && (i.uploaded_by === profile?.id || i.department_id === profile?.department_id)).length,
    prPending: purchaseRequestsToApprove.length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-slate-500/10 dark:bg-slate-500/20 rounded-lg">
              <FileText className="w-4 h-4 text-slate-600 dark:text-slate-400" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Robocze</span>
          </div>
          <div className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark mb-0.5">{stats.draft}</div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Faktury robocze</p>
        </div>

        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-yellow-500/10 dark:bg-yellow-500/20 rounded-lg">
              <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Oczekujące</span>
          </div>
          <div className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark mb-0.5">{stats.waiting}</div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Do mojej weryfikacji</p>
        </div>

        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-red-500/10 dark:bg-red-500/20 rounded-lg">
              <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Odrzucone</span>
          </div>
          <div className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark mb-0.5">{stats.rejected}</div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Odrzucone faktury</p>
        </div>

        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-amber-500/10 dark:bg-amber-500/20 rounded-lg">
              <ShoppingCart className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Wnioski</span>
          </div>
          <div className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark mb-0.5">{stats.prPending}</div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Do akceptacji</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionBox
          title="Faktury robocze"
          icon={<FileText className="w-4 h-4 text-slate-600 dark:text-slate-400" />}
          iconBg="bg-slate-500/10 dark:bg-slate-500/20"
          emptyText="Brak faktur roboczych"
        >
          {myDraftInvoices.length > 0
            ? myDraftInvoices.map(inv => <InvoiceRow key={inv.id} invoice={inv} />)
            : <p className="text-center text-text-secondary-light dark:text-text-secondary-dark py-4 text-sm">Brak faktur roboczych</p>
          }
        </SectionBox>

        <SectionBox
          title="Faktury oczekujące na moją weryfikację"
          icon={<Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />}
          iconBg="bg-yellow-500/10 dark:bg-yellow-500/20"
          emptyText="Brak faktur oczekujących"
        >
          {waitingForMyApprovalInvoices.length > 0
            ? waitingForMyApprovalInvoices.map(inv => <InvoiceRow key={inv.id} invoice={inv} />)
            : <p className="text-center text-text-secondary-light dark:text-text-secondary-dark py-4 text-sm">Brak faktur oczekujących na weryfikację</p>
          }
        </SectionBox>

        <SectionBox
          title="Odrzucone faktury"
          icon={<XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />}
          iconBg="bg-red-500/10 dark:bg-red-500/20"
          emptyText="Brak odrzuconych faktur"
        >
          {rejectedInvoices.length > 0
            ? rejectedInvoices.map(inv => <InvoiceRow key={inv.id} invoice={inv} />)
            : <p className="text-center text-text-secondary-light dark:text-text-secondary-dark py-4 text-sm">Brak odrzuconych faktur</p>
          }
        </SectionBox>

        <SectionBox
          title="Wnioski zakupowe oczekujące na moją weryfikację"
          icon={<ShoppingCart className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
          iconBg="bg-amber-500/10 dark:bg-amber-500/20"
          emptyText="Brak wniosków do weryfikacji"
        >
          {prToApprove.length > 0
            ? prToApprove.map(req => <PurchaseRequestRow key={req.id} req={req} />)
            : <p className="text-center text-text-secondary-light dark:text-text-secondary-dark py-4 text-sm">Brak wniosków oczekujących na weryfikację</p>
          }
        </SectionBox>

        <SectionBox
          title="Odrzucone wnioski zakupowe"
          icon={<Package className="w-4 h-4 text-red-600 dark:text-red-400" />}
          iconBg="bg-red-500/10 dark:bg-red-500/20"
          emptyText="Brak odrzuconych wniosków"
        >
          {rejectedPurchaseRequests.length > 0
            ? rejectedPurchaseRequests.map(req => <PurchaseRequestRow key={req.id} req={req} />)
            : <p className="text-center text-text-secondary-light dark:text-text-secondary-dark py-4 text-sm">Brak odrzuconych wniosków zakupowych</p>
          }
        </SectionBox>
      </div>
    </div>
  );
}
