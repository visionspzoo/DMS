import { Calendar, User, Building2, CreditCard, TrendingUp, Tag } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import type { Database } from '../../lib/database.types';

type Invoice = Database['public']['Tables']['invoices']['Row'] & {
  invoice_tags?: Array<{
    id: string;
    tags: {
      id: string;
      name: string;
      color: string;
    };
  }>;
};

interface InvoiceListProps {
  invoices: Invoice[];
  onSelectInvoice: (invoice: Invoice) => void;
}

const statusColors = {
  draft: 'bg-slate-500/10 text-slate-600 border-slate-500/30 dark:bg-slate-500/20 dark:text-slate-400',
  waiting: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30 dark:bg-yellow-500/20 dark:text-yellow-400',
  pending: 'bg-brand-primary/10 text-brand-primary border-brand-primary/30 dark:bg-brand-primary/20',
  accepted: 'bg-status-success/10 text-status-success border-status-success/30 dark:bg-status-success/20',
  rejected: 'bg-status-error/10 text-status-error border-status-error/30 dark:bg-status-error/20',
  in_review: 'bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400',
};

const statusLabels = {
  draft: 'Robocza',
  waiting: 'Oczekująca',
  pending: 'W weryfikacji',
  in_review: 'W weryfikacji',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
};

function getUserSpecificStatus(invoice: Invoice, currentUserId: string): keyof typeof statusLabels {
  if (invoice.status === 'draft' || invoice.status === 'accepted' || invoice.status === 'rejected') {
    return invoice.status;
  }

  if (invoice.uploaded_by === currentUserId) {
    return 'in_review';
  }

  return 'waiting';
}

export function InvoiceList({ invoices, onSelectInvoice }: InvoiceListProps) {
  const { user } = useAuth();

  if (invoices.length === 0) {
    return (
      <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-sm p-12 text-center border border-slate-200 dark:border-slate-700/50">
        <CreditCard className="w-16 h-16 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-4" />
        <h3 className="text-lg font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
          Brak faktur w systemie
        </h3>
        <p className="text-text-secondary-light dark:text-text-secondary-dark">
          Dodaj pierwszą fakturę, aby rozpocząć proces akceptacji
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {invoices.map((invoice) => {
        const displayStatus = getUserSpecificStatus(invoice, user?.id || '');
        return (
          <button
            key={invoice.id}
            onClick={() => onSelectInvoice(invoice)}
            className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm hover:shadow-md transition-all p-2 text-left w-full border border-slate-200/50 hover:border-brand-primary/40 dark:border-slate-700/50 dark:hover:border-brand-primary/40"
          >
            <div className="flex items-center justify-between gap-3">
              {/* Left section - Dates */}
              <div className="flex flex-col gap-1 min-w-[90px]">
                <div className="flex items-center gap-1 text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  <Calendar className="w-3 h-3" />
                  <span>{invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('pl-PL') : '—'}</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  <TrendingUp className="w-3 h-3" />
                  <span>{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('pl-PL') : '—'}</span>
                </div>
              </div>

              {/* Middle section - Invoice details */}
              <div className="flex-1 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs text-text-primary-light dark:text-text-primary-dark">
                    {invoice.invoice_number || 'Brak numeru'}
                  </span>
                  <span className={`px-1.5 py-0 rounded-md text-[10px] font-medium border ${statusColors[displayStatus]}`}>
                    {statusLabels[displayStatus]}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  <Building2 className="w-3 h-3" />
                  <span className="truncate">{invoice.supplier_name || 'Przetwarzanie...'}</span>
                </div>
                {invoice.invoice_tags && invoice.invoice_tags.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <Tag className="w-2.5 h-2.5 text-text-secondary-light dark:text-text-secondary-dark" />
                    {invoice.invoice_tags.slice(0, 3).map((invoiceTag) => (
                      <span
                        key={invoiceTag.id}
                        className="px-1.5 py-0 rounded-full text-[10px] font-medium"
                        style={{
                          backgroundColor: `${invoiceTag.tags.color}15`,
                          color: invoiceTag.tags.color,
                        }}
                      >
                        {invoiceTag.tags.name}
                      </span>
                    ))}
                    {invoice.invoice_tags.length > 3 && (
                      <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                        +{invoice.invoice_tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Right section - Department, User, Amounts */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5 text-[10px]">
                  <span className="text-text-secondary-light dark:text-text-secondary-dark">Dział:</span>
                  <span className="text-text-secondary-light dark:text-text-secondary-dark">Przesyłający:</span>
                </div>
                <div className="flex flex-col gap-0.5 text-[10px]">
                  <span className="font-medium text-text-primary-light dark:text-text-primary-dark">
                    {invoice.department?.name || '—'}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <User className="w-2.5 h-2.5 text-text-secondary-light dark:text-text-secondary-dark" />
                    <span className="font-medium text-text-primary-light dark:text-text-primary-dark">
                      {invoice.uploader?.full_name || '—'}
                    </span>
                  </div>
                </div>

                {/* Amounts */}
                <div className="flex flex-col items-end gap-0 min-w-[120px] pl-3 border-l border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                    Netto: <span className="font-mono font-medium text-text-primary-light dark:text-text-primary-dark">
                      {invoice.net_amount ? invoice.net_amount.toFixed(2) : '—'}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                    VAT: <span className="font-mono font-medium text-text-primary-light dark:text-text-primary-dark">
                      {invoice.tax_amount ? invoice.tax_amount.toFixed(2) : '—'}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-text-primary-light dark:text-text-primary-dark font-mono mt-0.5">
                    {invoice.gross_amount ? `${invoice.gross_amount.toFixed(2)} ${invoice.currency}` : 'Przetwarzanie...'}
                  </div>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
