import { useState, useEffect } from 'react';
import { Download, RefreshCw, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { KSEFInvoiceModal } from './KSEFInvoiceModal';
import { fetchKSEFInvoices, checkKSEFStatus } from '../../lib/ksefApiClient';

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
  invoice_xml: string | null;
  xml_content: string | null;
  transferred_to_invoice_id: string | null;
  transferred_to_department_id: string | null;
  transferred_at: string | null;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
}

type TabType = 'unassigned' | 'assigned';

export function KSEFInvoicesPage() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('unassigned');
  const [invoices, setInvoices] = useState<KSEFInvoice[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [assignedCount, setAssignedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<KSEFInvoice | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [ksefStatus, setKsefStatus] = useState<any>(null);

  useEffect(() => {
    loadInvoices();
    loadDepartments();
    checkKSEFConnection();

    const subscription = supabase
      .channel('ksef-invoices-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ksef_invoices' }, () => {
        loadInvoices();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [activeTab]);

  const checkKSEFConnection = async () => {
    try {
      const status = await checkKSEFStatus();
      setKsefStatus(status);
    } catch (err) {
      console.error('Error checking KSEF status:', err);
    }
  };

  const loadDepartments = async () => {
    if (!profile) return;

    try {
      const { data: allDepts, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');

      if (error) {
        console.error('Error loading departments:', error);
        return;
      }

      if (allDepts && allDepts.length > 0) {
        setDepartments(allDepts);
      }
    } catch (error) {
      console.error('Error loading departments:', error);
    }
  };

  const loadInvoices = async () => {
    try {
      const { count: unassigned } = await supabase
        .from('ksef_invoices')
        .select('*', { count: 'exact', head: true })
        .is('transferred_to_invoice_id', null);

      const { count: assigned } = await supabase
        .from('ksef_invoices')
        .select('*', { count: 'exact', head: true })
        .not('transferred_to_invoice_id', 'is', null);

      setUnassignedCount(unassigned || 0);
      setAssignedCount(assigned || 0);

      let query = supabase
        .from('ksef_invoices')
        .select('*');

      if (activeTab === 'unassigned') {
        query = query.is('transferred_to_invoice_id', null);
      } else {
        query = query.not('transferred_to_invoice_id', 'is', null);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;
      setInvoices(data || []);
    } catch (error) {
      console.error('Error loading KSEF invoices:', error);
      setError('Nie udało się załadować faktur KSEF');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchInvoices = async () => {
    setFetching(true);
    setError('');
    setSuccessMessage('');

    try {
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - 30);
      const dateTo = new Date();

      const response = await fetchKSEFInvoices({
        dateFrom: dateFrom.toISOString().split('T')[0],
        dateTo: dateTo.toISOString().split('T')[0],
        subjectType: 'subject2',
        invoiceType: 'all',
        pageSize: 100,
        pageOffset: 0,
      });

      if (!response.success) {
        throw new Error('Nie udało się pobrać faktur z KSEF');
      }

      const ksefInvoices = response.data.invoices || [];
      let newInvoices = 0;

      for (const invoice of ksefInvoices) {
        const { data: existing } = await supabase
          .from('ksef_invoices')
          .select('id')
          .eq('ksef_reference_number', invoice.ksefNumber)
          .maybeSingle();

        if (!existing) {
          const netAmount = invoice.netAmount || 0;
          const grossAmount = invoice.grossAmount || 0;
          const taxAmount = grossAmount - netAmount;

          const { error: insertError } = await supabase
            .from('ksef_invoices')
            .insert({
              ksef_reference_number: invoice.ksefNumber,
              invoice_number: invoice.invoiceNumber || 'Brak numeru',
              supplier_name: invoice.seller?.name || '',
              supplier_nip: invoice.seller?.nip || '',
              buyer_name: invoice.buyer?.name || '',
              buyer_nip: invoice.buyer?.identifier?.value || '',
              issue_date: invoice.issueDate || null,
              gross_amount: grossAmount,
              net_amount: netAmount,
              tax_amount: taxAmount,
              currency: invoice.currency || 'PLN',
              fetched_by: profile?.id,
            });

          if (!insertError) {
            newInvoices++;
          } else {
            console.error('Error inserting invoice:', insertError);
          }
        }
      }

      setSuccessMessage(
        `Pobrano ${ksefInvoices.length} faktur z KSEF, ${newInvoices} nowych`
      );
      await loadInvoices();
    } catch (err: any) {
      console.error('KSEF fetch error:', err);
      setError(err.message || 'Nie udało się pobrać faktur z KSEF');
    } finally {
      setFetching(false);
    }
  };

  const handleTransferInvoice = async (departmentId: string) => {
    if (!selectedInvoice || !departmentId) {
      setError('Proszę wybrać dział');
      return;
    }

    setTransferring(true);
    setError('');
    setSuccessMessage('');

    try {
      // Step 1: Download PDF from KSEF API via proxy
      const proxyParams = new URLSearchParams({
        path: `/api/external/invoices/${encodeURIComponent(selectedInvoice.ksef_reference_number)}/pdf`,
      });

      const pdfResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ksef-proxy?${proxyParams}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
        }
      );

      if (!pdfResponse.ok) {
        throw new Error('Nie udało się pobrać PDF z KSEF');
      }

      const pdfBlob = await pdfResponse.blob();

      // Step 2: Convert to base64
      const base64Pdf = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });

      // Step 3: Get department info
      const { data: department, error: folderError } = await supabase
        .from('departments')
        .select('name, google_drive_draft_folder_id')
        .eq('id', departmentId)
        .maybeSingle();

      if (folderError) throw folderError;
      if (!department?.google_drive_draft_folder_id) {
        throw new Error('Brak folderu roboczego Google Drive dla wybranego działu');
      }

      // Step 4: Upload PDF to Google Drive
      const uploadResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-to-google-drive`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: `${selectedInvoice.invoice_number}.pdf`,
            fileBase64: base64Pdf,
            folderId: department.google_drive_draft_folder_id,
            mimeType: 'application/pdf',
          }),
        }
      );

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Google Drive upload failed:', errorText);
        throw new Error('Nie udało się przesłać PDF na Google Drive');
      }

      const uploadResult = await uploadResponse.json();
      const driveFileUrl = `https://drive.google.com/file/d/${uploadResult.fileId}/view`;

      // Step 5: Get exchange rate if needed
      let exchangeRate = 1;
      let plnGrossAmount = selectedInvoice.gross_amount;

      if (selectedInvoice.currency !== 'PLN' && selectedInvoice.issue_date) {
        try {
          const rateResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-exchange-rate`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                currency: selectedInvoice.currency,
                date: selectedInvoice.issue_date,
              }),
            }
          );

          if (rateResponse.ok) {
            const rateData = await rateResponse.json();
            exchangeRate = rateData.rate;
            plnGrossAmount = selectedInvoice.gross_amount * exchangeRate;
          }
        } catch (rateError) {
          console.error('Error fetching exchange rate:', rateError);
        }
      }

      // Step 6: Create invoice record with file URL and base64
      const taxAmount = selectedInvoice.tax_amount || (selectedInvoice.gross_amount - selectedInvoice.net_amount);

      const { data: newInvoice, error: insertError } = await supabase
        .from('invoices')
        .insert({
          invoice_number: selectedInvoice.invoice_number,
          supplier_name: selectedInvoice.supplier_name || 'Brak nazwy',
          supplier_nip: selectedInvoice.supplier_nip,
          gross_amount: selectedInvoice.gross_amount,
          net_amount: selectedInvoice.net_amount,
          tax_amount: taxAmount,
          currency: selectedInvoice.currency,
          issue_date: selectedInvoice.issue_date,
          status: 'draft',
          uploaded_by: profile?.id,
          department_id: departmentId,
          file_url: driveFileUrl,
          pdf_base64: base64Pdf,
          description: `Faktura z KSEF - dodana jako wersja robocza`,
          pln_gross_amount: plnGrossAmount,
          exchange_rate: exchangeRate,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Step 7: Update KSEF invoice record
      const { error: updateError } = await supabase
        .from('ksef_invoices')
        .update({
          transferred_to_invoice_id: newInvoice.id,
          transferred_to_department_id: departmentId,
          transferred_at: new Date().toISOString(),
        })
        .eq('id', selectedInvoice.id);

      if (updateError) throw updateError;

      // Step 8: Run OCR on the transferred invoice
      try {
        console.log('=== STARTING OCR FOR KSEF INVOICE ===');
        console.log('Invoice ID:', newInvoice.id);
        console.log('File URL:', driveFileUrl);

        const ocrResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-invoice-ocr`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileUrl: driveFileUrl,
              invoiceId: newInvoice.id,
            }),
          }
        );

        if (ocrResponse.ok) {
          const ocrData = await ocrResponse.json();
          console.log('✓ OCR completed successfully:', ocrData);
        } else {
          console.error('OCR failed:', await ocrResponse.text());
        }
      } catch (ocrError) {
        console.error('OCR error (non-blocking):', ocrError);
      }

      setSuccessMessage('Faktura została dodana do Moich Faktur z PDF i przetworzona przez OCR.');
      setSelectedInvoice(null);
      await loadInvoices();
    } catch (err: any) {
      setError(err.message || 'Nie udało się przenieść faktury');
      throw err;
    } finally {
      setTransferring(false);
    }
  };

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
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">
              Faktury KSEF
            </h1>
            <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
              Faktury pobrane z Krajowego Systemu e-Faktur
            </p>
          </div>
          <div className="flex gap-2 items-center">
            {ksefStatus?.data?.ksefSession?.active && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg text-sm">
                <CheckCircle className="w-4 h-4" />
                <span>Połączono z KSEF</span>
              </div>
            )}
            <button
              onClick={handleFetchInvoices}
              disabled={fetching}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition disabled:opacity-50 text-sm"
            >
              {fetching ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Pobieranie...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Pobierz faktury
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => {
              setLoading(true);
              setActiveTab('unassigned');
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === 'unassigned'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
            }`}
          >
            Nieprzypisane ({unassignedCount})
          </button>
          <button
            onClick={() => {
              setLoading(true);
              setActiveTab('assigned');
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === 'assigned'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
            }`}
          >
            Przypisane ({assignedCount})
          </button>
        </div>

        {error && (
          <div className="mt-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg flex items-start gap-2 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mt-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-3 py-2 rounded-lg text-sm">
            {successMessage}
          </div>
        )}
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        {invoices.length === 0 ? (
          <div className="p-6 text-center">
            <FileText className="w-12 h-12 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-3" />
            <p className="text-text-secondary-light dark:text-text-secondary-dark text-base">
              Brak faktur KSEF
            </p>
            <p className="text-text-secondary-light dark:text-text-secondary-dark text-xs mt-1">
              Kliknij przycisk "Pobierz faktury" aby pobrać faktury z systemu
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                    Numer faktury
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                    Dostawca
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                    Data wystawienia
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                    Kwota brutto
                  </th>
                  {activeTab === 'assigned' && (
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                      Dział
                    </th>
                  )}
                  {activeTab === 'assigned' && (
                    <th className="px-3 py-2 text-center text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                      Status
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    onClick={() => setSelectedInvoice(invoice)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition cursor-pointer"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                        <span className="font-medium text-text-primary-light dark:text-text-primary-dark text-sm">
                          {invoice.invoice_number}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        <p className="text-text-primary-light dark:text-text-primary-dark text-sm">
                          {invoice.supplier_name || 'Brak nazwy'}
                        </p>
                        {invoice.supplier_nip && (
                          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                            NIP: {invoice.supplier_nip}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-text-primary-light dark:text-text-primary-dark text-sm">
                      {invoice.issue_date
                        ? new Date(invoice.issue_date).toLocaleDateString('pl-PL')
                        : '-'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <span className="font-semibold text-text-primary-light dark:text-text-primary-dark font-mono text-sm">
                        {invoice.gross_amount.toLocaleString('pl-PL', {
                          minimumFractionDigits: 2,
                        })}{' '}
                        {invoice.currency}
                      </span>
                    </td>
                    {activeTab === 'assigned' && (
                      <>
                        <td className="px-3 py-2 text-text-primary-light dark:text-text-primary-dark text-sm">
                          {invoice.transferred_to_department_id
                            ? departments.find(d => d.id === invoice.transferred_to_department_id)?.name || 'Nieznany'
                            : '-'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            Przeniesiono
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedInvoice && (
        <KSEFInvoiceModal
          invoice={selectedInvoice}
          departments={departments}
          onClose={() => setSelectedInvoice(null)}
          onTransfer={handleTransferInvoice}
          transferring={transferring}
        />
      )}
    </div>
  );
}
