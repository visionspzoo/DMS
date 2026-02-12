import { useState, useEffect } from 'react';
import { X, FileText, Building2, Calendar, DollarSign, ArrowRight, RefreshCw, Undo2, AlertTriangle, User } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const AURA_HERBALS_NIP = '5851490834';

interface KSEFInvoice {
  id: string;
  ksef_reference_number: string;
  invoice_number: string;
  supplier_name: string | null;
  supplier_nip: string | null;
  buyer_name: string | null;
  buyer_nip: string | null;
  issue_date: string | null;
  net_amount: number;
  tax_amount: number | null;
  gross_amount: number;
  currency: string;
  transferred_to_invoice_id: string | null;
  transferred_to_department_id: string | null;
  transferred_at: string | null;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
}

interface DepartmentUser {
  id: string;
  full_name: string;
  email: string;
}

interface KSEFInvoiceModalProps {
  invoice: KSEFInvoice;
  departments: Department[];
  onClose: () => void;
  onTransfer: (departmentId: string, userId?: string) => Promise<void>;
  onUnassign: (ksefInvoiceId: string) => Promise<void>;
  transferring: boolean;
}

export function KSEFInvoiceModal({ invoice, departments, onClose, onTransfer, onUnassign, transferring }: KSEFInvoiceModalProps) {
  const { profile } = useAuth();
  const [selectedDepartment, setSelectedDepartment] = useState(invoice.transferred_to_department_id || '');
  const [selectedUser, setSelectedUser] = useState('');
  const [departmentUsers, setDepartmentUsers] = useState<DepartmentUser[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [showUnassignConfirm, setShowUnassignConfirm] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const isSupplierInvalid = invoice.supplier_nip === AURA_HERBALS_NIP;
  const isBuyerInvalid = invoice.buyer_nip !== AURA_HERBALS_NIP;
  const hasError = isSupplierInvalid || isBuyerInvalid;

  useEffect(() => {
    loadPdfContent();

    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedDepartment) {
      loadDepartmentUsers(selectedDepartment);
    } else {
      setDepartmentUsers([]);
      setSelectedUser('');
    }
  }, [selectedDepartment]);

  async function loadDepartmentUsers(departmentId: string) {
    try {
      const [primaryResult, membersResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email')
          .eq('department_id', departmentId)
          .order('full_name'),
        supabase
          .from('department_members')
          .select(`
            user_id,
            profiles:user_id (
              id,
              full_name,
              email
            )
          `)
          .eq('department_id', departmentId)
      ]);

      if (primaryResult.error) throw primaryResult.error;

      const users: DepartmentUser[] = [...(primaryResult.data || [])];

      if (!membersResult.error && membersResult.data) {
        membersResult.data.forEach((member: any) => {
          if (member.profiles && !users.find(u => u.id === member.profiles.id)) {
            users.push(member.profiles);
          }
        });
      }

      users.sort((a, b) => a.full_name.localeCompare(b.full_name));
      setDepartmentUsers(users);
    } catch (err) {
      console.error('Error loading department users:', err);
      setDepartmentUsers([]);
    }
  }

  const handleTransfer = async () => {
    if (!selectedDepartment) return;
    await onTransfer(selectedDepartment, selectedUser || undefined);
    setSelectedDepartment('');
    setSelectedUser('');
  };

  const handleUnassign = async () => {
    await onUnassign(invoice.id);
    setShowUnassignConfirm(false);
  };

  const decodeBase64ToPdfUrl = (base64: string): string => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const pdfBlob = new Blob([byteArray], { type: 'application/pdf' });
    return URL.createObjectURL(pdfBlob);
  };

  const loadPdfContent = async (forceRetry = false) => {
    if (pdfUrl && !forceRetry) return;

    if (forceRetry && pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }

    setLoadingPdf(true);
    setPdfError(null);

    try {
      const { data: ksefInvoiceData, error: ksefError } = await supabase
        .from('ksef_invoices')
        .select('pdf_base64')
        .eq('id', invoice.id)
        .maybeSingle();

      if (!ksefError && ksefInvoiceData?.pdf_base64) {
        setPdfUrl(decodeBase64ToPdfUrl(ksefInvoiceData.pdf_base64));
        return;
      }

      if (invoice.transferred_to_invoice_id) {
        const { data: transferredInvoice, error } = await supabase
          .from('invoices')
          .select('pdf_base64')
          .eq('id', invoice.transferred_to_invoice_id)
          .maybeSingle();

        if (!error && transferredInvoice?.pdf_base64) {
          setPdfUrl(decodeBase64ToPdfUrl(transferredInvoice.pdf_base64));
          return;
        }
      }

      setPdfError('Brak danych PDF (base64) dla tej faktury. Pobierz faktury ponownie z KSEF.');
    } catch (error) {
      console.error('Error loading PDF:', error);
      setPdfError(error instanceof Error ? error.message : 'Nieznany blad');
    } finally {
      setLoadingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-light-surface dark:bg-dark-surface rounded-2xl shadow-2xl w-full max-w-[95vw] h-[90vh] my-8 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700/50 flex-shrink-0">
          <h2 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">
            Szczegóły faktury KSEF
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
          >
            <X className="w-5 h-5 text-text-primary-light dark:text-text-primary-dark" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 h-full">
            {/* Left side - Document preview */}
            <div className="flex flex-col h-full">
              <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                Dokument PDF
              </h3>
              <div className="flex-1 border-2 border-slate-300 dark:border-slate-600 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800">
                {loadingPdf ? (
                  <div className="flex flex-col items-center justify-center h-full p-8">
                    <RefreshCw className="w-16 h-16 text-brand-primary mb-4 animate-spin" />
                    <p className="text-text-primary-light dark:text-text-primary-dark">
                      Pobieranie PDF...
                    </p>
                    <p className="text-text-secondary-light dark:text-text-secondary-dark text-xs mt-2">
                      Próba generowania z XML...
                    </p>
                  </div>
                ) : pdfUrl ? (
                  <iframe
                    src={pdfUrl}
                    className="w-full h-full"
                    title="Faktura PDF"
                  />
                ) : pdfError ? (
                  <div className="flex flex-col items-center justify-center h-full p-8">
                    <AlertTriangle className="w-16 h-16 text-orange-500 mb-4" />
                    <p className="text-text-primary-light dark:text-text-primary-dark text-sm text-center mb-4 max-w-md">
                      {pdfError}
                    </p>
                    <button
                      onClick={() => loadPdfContent(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition text-sm"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Spróbuj ponownie
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full p-8">
                    <FileText className="w-16 h-16 text-slate-400 mb-4" />
                    <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
                      Ładowanie PDF...
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right side - Invoice details */}
            <div className="flex flex-col h-full overflow-y-auto space-y-3 pr-2">
              <div className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-xl p-4">
                <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Informacje podstawowe
                </h3>
                <div className="space-y-3">
                  {hasError && (
                    <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-600 dark:border-red-500 rounded-lg p-2.5 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-red-900 dark:text-red-300 text-xs">
                          {isSupplierInvalid && 'Błąd: Pomylono strony faktury!'}
                          {!isSupplierInvalid && isBuyerInvalid && 'Uwaga: Faktura dla innej firmy!'}
                        </p>
                        <p className="text-red-800 dark:text-red-400 text-[10px] mt-0.5">
                          {isSupplierInvalid && 'Aura Herbals (NIP: 5851490834) to nabywca, nie sprzedawca. Dane zostały błędnie pobrane z KSEF.'}
                          {!isSupplierInvalid && isBuyerInvalid && 'Ta faktura nie jest wystawiona na Aura Herbals.'}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Numer faktury
                      </label>
                      <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                        {invoice.invoice_number}
                      </p>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Numer referencyjny KSeF
                      </label>
                      <p className="text-xs font-mono text-text-primary-light dark:text-text-primary-dark mt-1 break-all">
                        {invoice.ksef_reference_number}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Dostawca
                      </label>
                      <p className={`text-sm font-semibold mt-1 ${
                        isSupplierInvalid
                          ? 'text-red-600 dark:text-red-500'
                          : 'text-text-primary-light dark:text-text-primary-dark'
                      }`}>
                        {invoice.supplier_name || 'Brak nazwy'}
                      </p>
                      {invoice.supplier_nip && (
                        <p className={`text-xs mt-0.5 ${
                          isSupplierInvalid
                            ? 'text-red-600 dark:text-red-500 font-medium'
                            : 'text-text-secondary-light dark:text-text-secondary-dark'
                        }`}>
                          NIP: {invoice.supplier_nip}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Nabywca
                      </label>
                      <p className={`text-sm font-semibold mt-1 ${
                        isBuyerInvalid
                          ? 'text-orange-600 dark:text-orange-500'
                          : 'text-text-primary-light dark:text-text-primary-dark'
                      }`}>
                        {invoice.buyer_name || 'Brak nazwy'}
                      </p>
                      {invoice.buyer_nip && (
                        <p className={`text-xs mt-0.5 ${
                          isBuyerInvalid
                            ? 'text-orange-600 dark:text-orange-500 font-medium'
                            : 'text-text-secondary-light dark:text-text-secondary-dark'
                        }`}>
                          NIP: {invoice.buyer_nip}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Data wystawienia
                      </label>
                      <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mt-1 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {invoice.issue_date
                          ? new Date(invoice.issue_date).toLocaleDateString('pl-PL')
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Waluta
                      </label>
                      <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                        {invoice.currency}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-xl p-4">
                <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-3 flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Kwoty
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-light-surface dark:bg-dark-surface rounded-lg">
                    <label className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                      Netto
                    </label>
                    <p className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mt-1 font-mono">
                      {invoice.net_amount.toFixed(2)} {invoice.currency}
                    </p>
                  </div>
                  <div className="text-center p-3 bg-light-surface dark:bg-dark-surface rounded-lg">
                    <label className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                      VAT
                    </label>
                    <p className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mt-1 font-mono">
                      {invoice.tax_amount ? invoice.tax_amount.toFixed(2) : (invoice.gross_amount - invoice.net_amount).toFixed(2)} {invoice.currency}
                    </p>
                  </div>
                  <div className="text-center p-3 bg-brand-primary/10 rounded-lg">
                    <label className="text-[10px] font-medium text-brand-primary uppercase tracking-wide">
                      Brutto
                    </label>
                    <p className="text-base font-bold text-brand-primary mt-1 font-mono">
                      {invoice.gross_amount.toFixed(2)} {invoice.currency}
                    </p>
                  </div>
                </div>
              </div>

              {!invoice.transferred_to_invoice_id && (
                <div className="bg-gradient-to-br from-brand-primary/5 to-brand-primary/10 dark:from-brand-primary/10 dark:to-brand-primary/5 rounded-xl p-4 border-2 border-brand-primary/20">
                  <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mb-3 flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Dodaj do Roboczych
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                        Wybierz dział
                      </label>
                      {invoice.transferred_to_department_id && (
                        <p className="text-xs text-green-600 dark:text-green-400 mb-1.5">
                          Automatycznie przypisano na podstawie NIP dostawcy
                        </p>
                      )}
                      <select
                        value={selectedDepartment}
                        onChange={(e) => setSelectedDepartment(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent text-sm"
                        disabled={transferring}
                      >
                        <option value="">Wybierz dział</option>
                        {departments.map((dept) => (
                          <option key={dept.id} value={dept.id}>
                            {dept.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedDepartment && (
                      <div>
                        <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2 flex items-center gap-2">
                          <User className="w-4 h-4" />
                          Przypisz do osoby (opcjonalnie)
                        </label>
                        <select
                          value={selectedUser}
                          onChange={(e) => setSelectedUser(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent text-sm"
                          disabled={transferring}
                        >
                          <option value="">Kierownik działu</option>
                          {departmentUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.full_name}
                            </option>
                          ))}
                        </select>
                        {!selectedUser && (
                          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1.5">
                            Faktura zostanie przypisana do kierownika działu
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      onClick={handleTransfer}
                      disabled={transferring || !selectedDepartment}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {transferring ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Dodawanie...
                        </>
                      ) : (
                        <>
                          <ArrowRight className="w-4 h-4" />
                          Dodaj do Roboczych
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {invoice.transferred_to_invoice_id && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
                  <h3 className="text-base font-semibold text-green-700 dark:text-green-400 mb-2">
                    Faktura została dodana
                  </h3>
                  <p className="text-sm text-green-600 dark:text-green-300">
                    Ta faktura została już dodana do systemu jako wersja robocza
                    {invoice.transferred_at && (
                      <span className="block mt-1">
                        Data: {new Date(invoice.transferred_at).toLocaleString('pl-PL')}
                      </span>
                    )}
                  </p>
                  {profile?.role === 'Administrator' && (
                    <button
                      onClick={() => setShowUnassignConfirm(true)}
                      className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium text-sm"
                    >
                      <Undo2 className="w-4 h-4" />
                      Cofnij przypisanie
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showUnassignConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <Undo2 className="w-6 h-6 text-red-600 dark:text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Cofnij przypisanie
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Tej operacji nie można cofnąć
                </p>
              </div>
            </div>

            <p className="text-slate-700 dark:text-slate-300 mb-6">
              Czy na pewno chcesz cofnąć przypisanie faktury <strong>{invoice.invoice_number}</strong>?
              Plik zostanie usunięty z Google Drive, a faktura zostanie usunięta z systemu.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowUnassignConfirm(false)}
                disabled={transferring}
                className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition font-medium disabled:opacity-50"
              >
                Anuluj
              </button>
              <button
                onClick={handleUnassign}
                disabled={transferring}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {transferring ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Cofanie...
                  </>
                ) : (
                  <>
                    <Undo2 className="w-4 h-4" />
                    Cofnij przypisanie
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
