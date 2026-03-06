import { Calendar, User, Building2, CreditCard, TrendingUp, Tag, Upload, Mail, HardDrive, FileCheck } from 'lucide-react';
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
  cost_center?: { code: string; description: string } | null;
};

interface InvoiceListProps {
  invoices: Invoice[];
  onSelectInvoice: (invoice: Invoice) => void;
  selectedInvoices?: string[];
  onToggleSelect?: (invoiceId: string) => void;
  selectionMode?: boolean;
}

const statusColors = {
  draft: 'bg-slate-500/10 text-slate-600 border-slate-500/30 dark:bg-slate-500/20 dark:text-slate-400',
  waiting: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30 dark:bg-yellow-500/20 dark:text-yellow-400',
  pending: 'bg-brand-primary/10 text-brand-primary border-brand-primary/30 dark:bg-brand-primary/20',
  accepted: 'bg-green-500/10 text-green-600 border-green-500/30 dark:bg-green-500/20 dark:text-green-400',
  rejected: 'bg-status-error/10 text-status-error border-status-error/30 dark:bg-status-error/20',
  in_review: 'bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400',
  paid: 'bg-emerald-700/10 text-emerald-800 border-emerald-700/30 dark:bg-emerald-700/20 dark:text-emerald-400',
};

const statusLabels = {
  draft: 'Robocze',
  waiting: 'Oczekujące',
  pending: 'Oczekujące',
  in_review: 'W weryfikacji',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
  paid: 'Opłacona',
};

function getUserSpecificStatus(invoice: Invoice, currentUserId: string): keyof typeof statusLabels {
  if (invoice.status === 'draft') {
    // Draft jest zawsze wyświetlany jako "Robocze" dla:
    // - Uploadera
    // - Current approver
    // - Przełożonych (Kierownik widzi drafty Specjalistów, Dyrektor widzi drafty Kierowników i Specjalistów)
    // Wszyscy widzą status "Robocze"
    return 'draft';
  }

  if (invoice.status === 'accepted') {
    return 'accepted';
  }

  if (invoice.status === 'rejected') {
    return 'rejected';
  }

  if (invoice.status === 'paid') {
    return 'paid';
  }

  if (invoice.status === 'waiting') {
    if (invoice.current_approver_id === currentUserId) {
      return 'waiting';
    }

    if (invoice.uploaded_by === currentUserId) {
      return 'in_review';
    }

    return 'in_review';
  }

  return invoice.status as keyof typeof statusLabels;
}

const AURA_HERBALS_NIP = '5851490834';

export function InvoiceList({
  invoices,
  onSelectInvoice,
  selectedInvoices = [],
  onToggleSelect,
  selectionMode = false
}: InvoiceListProps) {
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

  const checkDuplicate = (currentInvoice: Invoice): boolean => {
    // Używamy flagi is_duplicate z bazy danych
    return (currentInvoice as any).is_duplicate === true;
  };

  return (
    <div className="grid gap-2">
      {invoices.map((invoice) => {
        const displayStatus = getUserSpecificStatus(invoice, user?.id || '');
        const isInvalidSupplier = invoice.supplier_nip === AURA_HERBALS_NIP ||
          (invoice.supplier_nip?.includes('[BŁĄD]')) ||
          (invoice.supplier_name?.includes('[BŁĄD'));
        const VALID_NIPS = [AURA_HERBALS_NIP, '8222407812'];
        const AURA_NAME_VARIANTS = ['aura herbals', 'auraherbals', 'aura herbal'];
        const buyerNameLower = invoice.buyer_name?.toLowerCase() || '';
        const isInvalidBuyer = invoice.buyer_nip
          ? !VALID_NIPS.includes(invoice.buyer_nip.replace(/[^0-9]/g, ''))
          : invoice.buyer_name
            ? !AURA_NAME_VARIANTS.some(v => buyerNameLower.includes(v))
            : false;
        const isDuplicate = checkDuplicate(invoice);
        const hasError = isInvalidSupplier || isInvalidBuyer || isDuplicate;
        const isSelected = selectedInvoices.includes(invoice.id);
        return (
          <button
            key={invoice.id}
            onClick={() => {
              if (selectionMode && onToggleSelect) {
                onToggleSelect(invoice.id);
              } else {
                onSelectInvoice(invoice);
              }
            }}
            title={
              isDuplicate ? 'DUPLIKAT' :
              isInvalidBuyer ? 'BŁĘDNY ODBIORCA' :
              isInvalidSupplier ? 'BŁĘDNY SPRZEDAWCA' :
              ''
            }
            className={`rounded-lg shadow-sm hover:shadow-md transition-all p-2 text-left w-full ${
              hasError
                ? 'bg-light-surface dark:bg-dark-surface border-2 border-red-600 dark:border-red-500 hover:border-red-700 dark:hover:border-red-600'
                : isSelected
                ? 'bg-brand-primary/5 dark:bg-brand-primary/10 border-2 border-brand-primary dark:border-brand-primary shadow-lg'
                : 'bg-light-surface dark:bg-dark-surface border border-slate-200/50 hover:border-brand-primary/40 dark:border-slate-700/50 dark:hover:border-brand-primary/40'
            } ${selectionMode ? 'cursor-pointer' : ''}`}
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
                  {(() => {
                    const sourceConfig = {
                      manual: { label: 'Reczna', icon: Upload, color: 'text-slate-500' },
                      email: { label: 'Email', icon: Mail, color: 'text-sky-500' },
                      google_drive: { label: 'Drive', icon: HardDrive, color: 'text-emerald-500' },
                      ksef: { label: 'KSeF', icon: FileCheck, color: 'text-amber-500' },
                    };
                    const rawSource = (invoice as any).source || '';
                    const sourceKey = rawSource.startsWith('email:') ? 'email' : rawSource;
                    const emailAddress = rawSource.startsWith('email:') ? rawSource.substring(6) : null;
                    const src = sourceConfig[sourceKey as keyof typeof sourceConfig];
                    if (!src) return null;
                    const Icon = src.icon;
                    return (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] ${src.color}`} title={`Zrodlo: ${emailAddress ? `Email: ${emailAddress}` : src.label}`}>
                        <Icon className="w-3 h-3" />
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  <Building2 className={`w-3 h-3 ${isInvalidBuyer ? 'text-red-600 dark:text-red-500' : ''}`} />
                  <span className={`truncate ${isInvalidBuyer ? 'text-red-600 dark:text-red-500 font-semibold' : ''}`}>
                    {(invoice.supplier_name || 'Przetwarzanie...').replace(/\[BŁĄD[^\]]*\]\s*/g, '')}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  <CreditCard className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0" />
                  {invoice.cost_center ? (
                    <span className="font-medium text-text-primary-light dark:text-text-primary-dark truncate max-w-[160px]">
                      {invoice.cost_center.code} – {invoice.cost_center.description}
                    </span>
                  ) : (
                    <span className="font-bold text-red-500 dark:text-red-400">—</span>
                  )}
                  {(invoice as any).bez_mpk && (
                    <span className="ml-1 px-1 py-0.5 text-[9px] bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-semibold rounded uppercase tracking-wide">bez MPK</span>
                  )}
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
                  <span className="text-text-secondary-light dark:text-text-secondary-dark">Właściciel:</span>
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
                <div className="flex flex-col items-end gap-0 min-w-[140px] pl-3 border-l border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                    Netto: <span className="font-mono font-medium text-text-primary-light dark:text-text-primary-dark">
                      {invoice.net_amount != null ? `${invoice.net_amount.toFixed(2)} ${invoice.currency}` : '—'}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                    VAT: <span className="font-mono font-medium text-text-primary-light dark:text-text-primary-dark">
                      {invoice.tax_amount != null ? `${invoice.tax_amount.toFixed(2)} ${invoice.currency}` : '—'}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-text-primary-light dark:text-text-primary-dark font-mono mt-0.5">
                    {invoice.gross_amount != null ? `${invoice.gross_amount.toFixed(2)} ${invoice.currency}` : 'Przetwarzanie...'}
                  </div>
                  {invoice.currency !== 'PLN' && invoice.pln_gross_amount != null && invoice.exchange_rate && invoice.exchange_rate !== 1 && (
                    <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark font-mono">
                      ≈ {invoice.pln_gross_amount.toFixed(2)} PLN
                      <span className="ml-1 opacity-70">(kurs: {invoice.exchange_rate.toFixed(4)})</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
