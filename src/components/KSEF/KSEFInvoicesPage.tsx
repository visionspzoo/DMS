import { useState, useEffect } from 'react';
import { Download, RefreshCw, FileText, AlertCircle, CheckCircle, Settings, ChevronUp, ChevronDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { KSEFInvoiceModal } from './KSEFInvoiceModal';
import { KSEFConfiguration } from './KSEFConfiguration';
import { fetchKSEFInvoices, fetchKSEFInvoiceXML, checkKSEFStatus } from '../../lib/ksefApiClient';
import { getAccessibleDepartments } from '../../lib/departmentUtils';

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
  invoice_xml: string | null;
  xml_content: string | null;
  transferred_to_invoice_id: string | null;
  transferred_to_department_id: string | null;
  transferred_at: string | null;
  assigned_to_department_at: string | null;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
}

type MainTabType = 'invoices' | 'configuration';
type InvoiceTabType = 'unassigned' | 'assigned';
type SortColumn = 'issue_date' | 'gross_amount' | 'supplier_name' | 'department';
type SortDirection = 'asc' | 'desc';

export function KSEFInvoicesPage() {
  const { profile } = useAuth();
  const [mainTab, setMainTab] = useState<MainTabType>('invoices');
  const [invoiceTab, setInvoiceTab] = useState<InvoiceTabType>('unassigned');
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
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const canAccessKSEFConfig = profile?.can_access_ksef_config === true ||
                               profile?.is_admin === true ||
                               profile?.role === 'CEO';

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const getSortedInvoices = () => {
    if (!sortColumn) return invoices;

    return [...invoices].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortColumn) {
        case 'issue_date':
          aValue = a.issue_date ? new Date(a.issue_date).getTime() : 0;
          bValue = b.issue_date ? new Date(b.issue_date).getTime() : 0;
          break;
        case 'gross_amount':
          aValue = a.gross_amount;
          bValue = b.gross_amount;
          break;
        case 'supplier_name':
          aValue = (a.supplier_name || '').toLowerCase();
          bValue = (b.supplier_name || '').toLowerCase();
          break;
        case 'department':
          const aDept = departments.find(d => d.id === a.transferred_to_department_id)?.name || '';
          const bDept = departments.find(d => d.id === b.transferred_to_department_id)?.name || '';
          aValue = aDept.toLowerCase();
          bValue = bDept.toLowerCase();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

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
  }, [invoiceTab]);

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
      const accessibleDepts = await getAccessibleDepartments(profile);
      setDepartments(accessibleDepts);
    } catch (error) {
      console.error('Error loading departments:', error);
    }
  };

  const loadInvoices = async () => {
    try {
      const { count: unassigned } = await supabase
        .from('ksef_invoices')
        .select('*', { count: 'exact', head: true })
        .is('transferred_to_invoice_id', null)
        .is('transferred_to_department_id', null);

      const { count: assigned } = await supabase
        .from('ksef_invoices')
        .select('*', { count: 'exact', head: true })
        .or('transferred_to_invoice_id.not.is.null,transferred_to_department_id.not.is.null');

      setUnassignedCount(unassigned || 0);
      setAssignedCount(assigned || 0);

      let query = supabase
        .from('ksef_invoices')
        .select('*');

      if (invoiceTab === 'unassigned') {
        query = query
          .is('transferred_to_invoice_id', null)
          .is('transferred_to_department_id', null)
          .order('created_at', { ascending: false });
      } else {
        query = query
          .or('transferred_to_invoice_id.not.is.null,transferred_to_department_id.not.is.null')
          .order('assigned_to_department_at', { ascending: false, nullsFirst: false })
          .order('transferred_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false });
      }

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
      console.log('=== ROZPOCZYNAM POBIERANIE FAKTUR KSEF ===');
      console.log('Profile ID:', profile?.id);
      console.log('Profile email:', profile?.email);

      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - 30);
      const dateTo = new Date();

      console.log('Zakres dat:', dateFrom.toISOString().split('T')[0], '-', dateTo.toISOString().split('T')[0]);

      const response = await fetchKSEFInvoices({
        dateFrom: dateFrom.toISOString().split('T')[0],
        dateTo: dateTo.toISOString().split('T')[0],
        subjectType: 'subject2',
        invoiceType: 'all',
        pageSize: 100,
        pageOffset: 0,
      });

      console.log('Odpowiedź KSEF:', response);

      if (!response.success) {
        throw new Error('Nie udało się pobrać faktur z KSEF');
      }

      const ksefInvoices = response.data.invoices || [];
      console.log(`Znaleziono ${ksefInvoices.length} faktur w KSEF`);
      let newInvoices = 0;
      let skippedInvoices = 0;
      let errorInvoices = 0;

      for (const invoice of ksefInvoices) {
        console.log(`\n--- Przetwarzanie faktury: ${invoice.invoiceNumber} (${invoice.ksefNumber}) ---`);

        const { data: existing, error: checkError } = await supabase
          .from('ksef_invoices')
          .select('id')
          .eq('ksef_reference_number', invoice.ksefNumber)
          .maybeSingle();

        if (checkError) {
          console.error('Błąd sprawdzania istnienia faktury:', checkError);
        }

        if (existing) {
          console.log('Faktura już istnieje w bazie, pomijam');
          skippedInvoices++;
          continue;
        }

        console.log('Faktura nie istnieje, dodaję do bazy...');

        const netAmount = invoice.netAmount || 0;
        const grossAmount = invoice.grossAmount || 0;
        const taxAmount = grossAmount - netAmount;

        console.log('Kwoty:', { netAmount, grossAmount, taxAmount });

        let xmlContent = null;
        try {
          xmlContent = await fetchKSEFInvoiceXML(invoice.ksefNumber);
          console.log(`✓ Pobrano XML dla faktury ${invoice.invoiceNumber}`);
        } catch (xmlError) {
          console.error(`Nie udało się pobrać XML dla faktury ${invoice.invoiceNumber}:`, xmlError);
        }

        const invoiceData = {
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
          xml_content: xmlContent,
          fetched_by: profile?.id,
        };

        console.log('Dane faktury do zapisu:', invoiceData);

        const { data: inserted, error: insertError } = await supabase
          .from('ksef_invoices')
          .insert(invoiceData)
          .select();

        if (insertError) {
          console.error('❌ Błąd podczas zapisu faktury:', insertError);
          errorInvoices++;
        } else {
          console.log('✓ Faktura zapisana pomyślnie:', inserted);
          newInvoices++;
        }
      }

      console.log('\n=== PODSUMOWANIE ===');
      console.log(`Łącznie faktur w KSEF: ${ksefInvoices.length}`);
      console.log(`Nowe faktury: ${newInvoices}`);
      console.log(`Pominięte (już istnieją): ${skippedInvoices}`);
      console.log(`Błędy: ${errorInvoices}`);

      if (errorInvoices > 0) {
        setError(`Pobrano ${ksefInvoices.length} faktur, ${newInvoices} nowych, ${errorInvoices} błędów. Sprawdź konsolę przeglądarki.`);
      } else {
        setSuccessMessage(
          `Pobrano ${ksefInvoices.length} faktur z KSEF, ${newInvoices} nowych`
        );
      }

      await loadInvoices();
    } catch (err: any) {
      console.error('KSEF fetch error:', err);
      setError(err.message || 'Nie udało się pobrać faktur z KSEF');
    } finally {
      setFetching(false);
    }
  };

  const handleUnassignInvoice = async (ksefInvoiceId: string) => {
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const { data: ksefInvoice, error: ksefError } = await supabase
        .from('ksef_invoices')
        .select('transferred_to_invoice_id')
        .eq('id', ksefInvoiceId)
        .maybeSingle();

      if (ksefError) throw ksefError;
      if (!ksefInvoice?.transferred_to_invoice_id) {
        throw new Error('Faktura nie jest przypisana');
      }

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select('google_drive_id, file_url')
        .eq('id', ksefInvoice.transferred_to_invoice_id)
        .maybeSingle();

      if (invoiceError) throw invoiceError;

      if (invoice?.google_drive_id) {
        try {
          const deleteResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-from-google-drive`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                fileId: invoice.google_drive_id,
              }),
            }
          );

          if (!deleteResponse.ok) {
            console.error('Failed to delete from Google Drive:', await deleteResponse.text());
          } else {
            console.log('✓ File deleted from Google Drive');
          }
        } catch (driveError) {
          console.error('Error deleting from Google Drive:', driveError);
        }
      }

      const { error: deleteInvoiceError } = await supabase
        .from('invoices')
        .delete()
        .eq('id', ksefInvoice.transferred_to_invoice_id);

      if (deleteInvoiceError) throw deleteInvoiceError;

      const { error: updateKsefError } = await supabase
        .from('ksef_invoices')
        .update({
          transferred_to_invoice_id: null,
          transferred_to_department_id: null,
          transferred_at: null,
        })
        .eq('id', ksefInvoiceId);

      if (updateKsefError) throw updateKsefError;

      setSuccessMessage('Przypisanie faktury zostało cofnięte');
      setSelectedInvoice(null);
      await loadInvoices();
    } catch (err: any) {
      console.error('Error unassigning invoice:', err);
      setError(err.message || 'Nie udało się cofnąć przypisania faktury');
    } finally {
      setLoading(false);
    }
  };

  const handleTransferInvoice = async (departmentId: string, userId?: string) => {
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

      // Step 3: Download XML from KSEF API
      let xmlContent = null;
      try {
        xmlContent = await fetchKSEFInvoiceXML(selectedInvoice.ksef_reference_number);
        console.log('✓ Pobrano XML dla faktury', selectedInvoice.invoice_number);
      } catch (xmlError) {
        console.error('Nie udało się pobrać XML (non-blocking):', xmlError);
      }

      // Step 4: Get department info
      const { data: department, error: folderError } = await supabase
        .from('departments')
        .select('name, google_drive_draft_folder_id')
        .eq('id', departmentId)
        .maybeSingle();

      if (folderError) throw folderError;
      if (!department) {
        throw new Error('Nie znaleziono działu');
      }

      // Step 5: Upload PDF to Google Drive (optional, if configured)
      let driveFileUrl = null;
      let googleDriveId = null;

      if (department.google_drive_draft_folder_id) {
        try {
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

          if (uploadResponse.ok) {
            const uploadResult = await uploadResponse.json();
            googleDriveId = uploadResult.fileId;
            driveFileUrl = `https://drive.google.com/file/d/${uploadResult.fileId}/view`;
            console.log('✓ PDF przesłany na Google Drive');
          } else {
            console.warn('Nie udało się przesłać PDF na Google Drive (non-blocking)');
          }
        } catch (uploadError) {
          console.error('Google Drive upload failed (non-blocking):', uploadError);
        }
      }

      // Step 6: Get exchange rate if needed
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

      // Step 7: Create invoice record with file URL and base64
      const taxAmount = selectedInvoice.tax_amount || (selectedInvoice.gross_amount - selectedInvoice.net_amount);

      const invoiceData: any = {
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
        google_drive_id: googleDriveId,
        pdf_base64: base64Pdf,
        description: `Faktura z KSEF - dodana jako wersja robocza`,
        pln_gross_amount: plnGrossAmount,
        exchange_rate: exchangeRate,
        source: 'ksef',
      };

      if (userId) {
        invoiceData.current_approver_id = userId;
      }

      const { data: newInvoice, error: insertError } = await supabase
        .from('invoices')
        .insert(invoiceData)
        .select()
        .single();

      if (insertError) throw insertError;

      // Step 8: Update KSEF invoice record with XML content
      const updateData: any = {
        transferred_to_invoice_id: newInvoice.id,
        transferred_to_department_id: departmentId,
        transferred_at: new Date().toISOString(),
        assigned_to_department_at: new Date().toISOString(),
      };

      if (xmlContent) {
        updateData.xml_content = xmlContent;
      }

      const { error: updateError } = await supabase
        .from('ksef_invoices')
        .update(updateData)
        .eq('id', selectedInvoice.id);

      if (updateError) throw updateError;

      // Step 9: Run OCR on the transferred invoice (only if uploaded to Google Drive)
      if (driveFileUrl) {
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
      }

      setSuccessMessage('Faktura została dodana do Moich Faktur z PDF' + (xmlContent ? ' i XML' : '') + (driveFileUrl ? ' i przetworzona przez OCR' : '') + '.');
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
            {mainTab === 'invoices' && (
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
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-1 mb-4">
          <button
            onClick={() => setMainTab('invoices')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
              mainTab === 'invoices'
                ? 'bg-brand-primary text-white shadow-sm'
                : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
            }`}
          >
            <FileText className="w-4 h-4" />
            Faktury
          </button>
          {canAccessKSEFConfig && (
            <button
              onClick={() => setMainTab('configuration')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                mainTab === 'configuration'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
              }`}
            >
              <Settings className="w-4 h-4" />
              Konfiguracja
            </button>
          )}
        </div>

        {mainTab === 'invoices' && (
          <div className="flex items-center gap-1 bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-1">
            <button
              onClick={() => {
                setLoading(true);
                setInvoiceTab('unassigned');
              }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                invoiceTab === 'unassigned'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
              }`}
            >
              Nieprzypisane ({unassignedCount})
            </button>
            <button
              onClick={() => {
                setLoading(true);
                setInvoiceTab('assigned');
              }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                invoiceTab === 'assigned'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
              }`}
            >
              Przypisane ({assignedCount})
            </button>
          </div>
        )}

        {mainTab === 'invoices' && error && (
          <div className="mt-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg flex items-start gap-2 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {mainTab === 'invoices' && successMessage && (
          <div className="mt-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-3 py-2 rounded-lg text-sm">
            {successMessage}
          </div>
        )}
      </div>

      {mainTab === 'configuration' && canAccessKSEFConfig ? (
        <KSEFConfiguration />
      ) : mainTab === 'configuration' && !canAccessKSEFConfig ? (
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-12 text-center">
          <AlertCircle className="w-12 h-12 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-3" />
          <p className="text-text-primary-light dark:text-text-primary-dark font-medium mb-1">
            Brak dostępu
          </p>
          <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
            Nie masz uprawnień do konfiguracji KSEF. Skontaktuj się z administratorem.
          </p>
        </div>
      ) : (
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
                  <th
                    className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition"
                    onClick={() => handleSort('supplier_name')}
                  >
                    <div className="flex items-center gap-1">
                      Dostawca
                      {sortColumn === 'supplier_name' && (
                        sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition"
                    onClick={() => handleSort('issue_date')}
                  >
                    <div className="flex items-center gap-1">
                      Data wystawienia
                      {sortColumn === 'issue_date' && (
                        sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 text-right text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition"
                    onClick={() => handleSort('gross_amount')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Kwota brutto
                      {sortColumn === 'gross_amount' && (
                        sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition"
                    onClick={() => handleSort('department')}
                  >
                    <div className="flex items-center gap-1">
                      Dział
                      {sortColumn === 'department' && (
                        sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                  {invoiceTab === 'assigned' && (
                    <th className="px-3 py-2 text-center text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                      Status
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {getSortedInvoices().map((invoice) => {
                  const isSupplierInvalid = invoice.supplier_nip === AURA_HERBALS_NIP;
                  const isBuyerInvalid = invoice.buyer_nip !== AURA_HERBALS_NIP;
                  const hasError = isSupplierInvalid || isBuyerInvalid;

                  return (
                  <tr
                    key={invoice.id}
                    onClick={() => setSelectedInvoice(invoice)}
                    className={`transition cursor-pointer ${
                      hasError
                        ? 'border-l-4 border-l-red-600 bg-red-50/50 dark:bg-red-900/10 hover:bg-red-100/50 dark:hover:bg-red-900/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                    }`}
                    title={
                      isSupplierInvalid
                        ? '⚠️ Błąd: Aura Herbals to kupujący, nie sprzedawca!'
                        : isBuyerInvalid
                        ? '⚠️ Uwaga: To faktura dla innej firmy'
                        : undefined
                    }
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
                        <p className={`text-sm ${
                          isSupplierInvalid
                            ? 'text-red-600 dark:text-red-500 font-semibold'
                            : 'text-text-primary-light dark:text-text-primary-dark'
                        }`}>
                          {invoice.supplier_name || 'Brak nazwy'}
                        </p>
                        {invoice.supplier_nip && (
                          <p className={`text-xs ${
                            isSupplierInvalid
                              ? 'text-red-600 dark:text-red-500 font-medium'
                              : 'text-text-secondary-light dark:text-text-secondary-dark'
                          }`}>
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
                    <td className="px-3 py-2 text-sm">
                      {invoice.transferred_to_department_id ? (
                        <span className="inline-flex items-center gap-1 text-text-primary-light dark:text-text-primary-dark">
                          {departments.find(d => d.id === invoice.transferred_to_department_id)?.name || 'Nieznany'}
                          {!invoice.transferred_to_invoice_id && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap">
                              auto
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-text-secondary-light dark:text-text-secondary-dark">-</span>
                      )}
                    </td>
                    {invoiceTab === 'assigned' && (
                      <td className="px-3 py-2 text-center">
                        <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Przeniesiono
                        </span>
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {selectedInvoice && (
        <KSEFInvoiceModal
          invoice={selectedInvoice}
          departments={departments}
          onClose={() => setSelectedInvoice(null)}
          onTransfer={handleTransferInvoice}
          onUnassign={handleUnassignInvoice}
          transferring={transferring}
        />
      )}
    </div>
  );
}
