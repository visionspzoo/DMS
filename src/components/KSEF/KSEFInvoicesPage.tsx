import { useState, useEffect, useRef } from 'react';
import { RefreshCw, FileText, AlertCircle, CheckCircle, Settings, ChevronUp, ChevronDown, Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { KSEFInvoiceModal } from './KSEFInvoiceModal';
import { KSEFConfiguration } from './KSEFConfiguration';
import { fetchKSEFInvoices, checkKSEFStatus } from '../../lib/ksefApiClient';
import { getAccessibleDepartments } from '../../lib/departmentUtils';

const AURA_HERBALS_NIP = '5851490834';
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

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
  const { user, profile } = useAuth();
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
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [nextSyncIn, setNextSyncIn] = useState<number>(SYNC_INTERVAL_MS);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    const savedLastSync = localStorage.getItem('ksef_last_sync');
    if (savedLastSync) {
      setLastSync(savedLastSync);
      const timeSinceLastSync = Date.now() - new Date(savedLastSync).getTime();
      const timeUntilNextSync = Math.max(0, SYNC_INTERVAL_MS - timeSinceLastSync);
      setNextSyncIn(timeUntilNextSync);
    }

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

  useEffect(() => {
    if (!canAccessKSEFConfig) return;

    const savedLastSync = localStorage.getItem('ksef_last_sync');
    let initialDelay = SYNC_INTERVAL_MS;

    if (savedLastSync) {
      const timeSinceLastSync = Date.now() - new Date(savedLastSync).getTime();
      initialDelay = Math.max(0, SYNC_INTERVAL_MS - timeSinceLastSync);
    }

    const initialTimeout = setTimeout(() => {
      handleFetchInvoices();

      syncTimerRef.current = setInterval(() => {
        handleFetchInvoices();
      }, SYNC_INTERVAL_MS);
    }, initialDelay);

    countdownRef.current = setInterval(() => {
      setNextSyncIn(prev => Math.max(0, prev - 1000));
    }, 1000);

    return () => {
      clearTimeout(initialTimeout);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [canAccessKSEFConfig]);

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
    setLoading(true);
    setInvoices([]);

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

  const autoTransferAssignedInvoices = async () => {
    try {
      setTransferring(true);
      setError('');
      setSuccessMessage('');

      console.log('🔄 Sprawdzanie faktur do automatycznego przeniesienia...');

      // Get all auto-assigned invoices that haven't been transferred yet
      const { data: assignedInvoices, error: fetchError } = await supabase
        .from('ksef_invoices')
        .select('*')
        .not('transferred_to_department_id', 'is', null)
        .is('transferred_to_invoice_id', null);

      if (fetchError) {
        console.error('Błąd podczas pobierania faktur do transferu:', fetchError);
        setError('Nie udało się pobrać listy faktur do przeniesienia');
        return;
      }

      if (!assignedInvoices || assignedInvoices.length === 0) {
        console.log('✓ Brak faktur do automatycznego przeniesienia');
        setSuccessMessage('Brak faktur do automatycznego przeniesienia');
        return;
      }

      console.log(`📦 Znaleziono ${assignedInvoices.length} faktur do przeniesienia`);
      console.log('📋 Faktury do przeniesienia:', assignedInvoices.map(inv => ({
        id: inv.id,
        number: inv.invoice_number,
        department: inv.transferred_to_department_id,
        fetched_by: inv.fetched_by
      })));
      setSuccessMessage(`Automatyczne przenoszenie ${assignedInvoices.length} faktur do systemu...`);

      // Refresh session to ensure valid token
      console.log('🔄 Odświeżanie tokena przed transferem...');
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError || !refreshData.session) {
        console.error('Nie udało się odświeżyć sesji:', refreshError);
        setError('Nie można odświeżyć autoryzacji. Zaloguj się ponownie.');
        return;
      }

      const session = refreshData.session;
      console.log('✓ Token odświeżony pomyślnie');

      let transferred = 0;
      let failed = 0;

      for (const invoice of assignedInvoices) {
        try {
          console.log(`🔄 Przenoszenie faktury ${invoice.invoice_number}...`);

          const transferResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transfer-ksef-invoice`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({
                ksefInvoiceId: invoice.id,
                departmentId: invoice.transferred_to_department_id,
              }),
            }
          );

          console.log(`📊 Status odpowiedzi: ${transferResponse.status}`);

          if (transferResponse.ok) {
            const result = await transferResponse.json();
            console.log(`✓ Faktura ${invoice.invoice_number} przeniesiona pomyślnie`, result);
            transferred++;
          } else {
            const responseText = await transferResponse.text();
            console.error(`❌ Błąd przenoszenia faktury ${invoice.invoice_number}:`);
            console.error(`   Status: ${transferResponse.status}`);
            console.error(`   Response:`, responseText);
            try {
              const errorData = JSON.parse(responseText);
              console.error(`   Parsed error:`, errorData);
            } catch (e) {
              console.error(`   Nie można sparsować odpowiedzi jako JSON`);
            }
            failed++;
          }
        } catch (transferError) {
          console.error(`❌ Wyjątek podczas przenoszenia faktury ${invoice.invoice_number}:`, transferError);
          failed++;
        }

        // Update progress message
        setSuccessMessage(
          `Przenoszenie faktur: ${transferred + failed}/${assignedInvoices.length} (${transferred} OK, ${failed} błędów)`
        );
      }

      // Final summary
      if (failed === 0) {
        setSuccessMessage(
          `✓ Automatycznie przeniesiono ${transferred} faktur do systemu z pełnym podglądem PDF`
        );
      } else {
        setError(
          `Przeniesiono ${transferred} faktur, ${failed} nie udało się. Sprawdź konsolę dla szczegółów.`
        );
      }

      // Reload invoices to show updated state
      await loadInvoices();
    } catch (error) {
      console.error('Błąd podczas automatycznego transferu:', error);
      setError('Nieoczekiwany błąd podczas automatycznego transferu');
    } finally {
      setTransferring(false);
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

      // Add delay between requests to avoid rate limiting (429 errors)
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      const fetchWithRetry = async (fetchFn: () => Promise<Response>, maxRetries = 3): Promise<Response> => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const response = await fetchFn();

            if (response.ok) {
              const jsonData = await response.json();
              if (!jsonData.success && (jsonData.httpStatus === 429 || jsonData.error?.includes('429'))) {
                const waitTime = Math.pow(2, attempt) * 15000;
                console.log(`Rate limit (429), czekam ${waitTime / 1000}s... (proba ${attempt + 1}/${maxRetries})`);
                setSuccessMessage(`Rate limit - czekam ${waitTime / 1000}s...`);
                await delay(waitTime);
                continue;
              }
              return new Response(JSON.stringify(jsonData), { status: 200, headers: response.headers });
            }

            if (response.status === 429 || response.status === 500) {
              const waitTime = Math.pow(2, attempt) * 15000;
              console.log(`Rate limit (${response.status}), czekam ${waitTime / 1000}s... (proba ${attempt + 1}/${maxRetries})`);
              setSuccessMessage(`Rate limit - czekam ${waitTime / 1000}s...`);
              await delay(waitTime);
              continue;
            }
            return response;
          } catch (err) {
            if (attempt === maxRetries - 1) throw err;
            const waitTime = Math.pow(2, attempt) * 10000;
            await delay(waitTime);
          }
        }
        throw new Error('Przekroczono maksymalną liczbę prób');
      };

      for (let i = 0; i < ksefInvoices.length; i++) {
        const invoice = ksefInvoices[i];
        console.log(`\n--- Przetwarzanie faktury ${i + 1}/${ksefInvoices.length}: ${invoice.invoiceNumber} (${invoice.ksefNumber}) ---`);

        setSuccessMessage(`Pobieranie faktur: ${i + 1}/${ksefInvoices.length} - ${invoice.invoiceNumber}...`);

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

        let pdfBase64 = null;
        try {
          console.log(`Pobieranie PDF base64 dla faktury ${invoice.invoiceNumber}...`);
          setSuccessMessage(`Pobieranie PDF: ${i + 1}/${ksefInvoices.length} - ${invoice.invoiceNumber}...`);
          if (i > 0) await delay(10000);

          const pdfProxyParams = new URLSearchParams({
            path: `/api/external/invoices/${encodeURIComponent(invoice.ksefNumber)}/pdf-base64`,
          });

          const pdfResponse = await fetchWithRetry(() =>
            fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ksef-proxy?${pdfProxyParams}`,
              {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                  'Content-Type': 'application/json',
                },
              }
            )
          );

          if (pdfResponse.ok) {
            const pdfData = await pdfResponse.json();
            if (pdfData.success && pdfData.data?.base64) {
              pdfBase64 = pdfData.data.base64;
              console.log(`Pobrano PDF base64 (${pdfBase64.length} znaków)`);
            } else {
              console.warn('Nieprawidlowa odpowiedz pdf-base64:', pdfData);
            }
          } else {
            console.warn(`Blad pobierania PDF base64: ${pdfResponse.status}`);
          }
        } catch (pdfError) {
          console.error(`Blad pobierania PDF dla faktury ${invoice.invoiceNumber}:`, pdfError);
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
          pdf_base64: pdfBase64,
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

      // Auto-transfer any newly assigned invoices
      await autoTransferAssignedInvoices();
      const syncTime = new Date().toISOString();
      setLastSync(syncTime);
      localStorage.setItem('ksef_last_sync', syncTime);
      setNextSyncIn(SYNC_INTERVAL_MS);
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

  const handleDeleteInvoice = async (ksefInvoiceId: string) => {
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      // Check if this KSEF invoice was transferred to the system
      const { data: ksefInvoice, error: ksefError } = await supabase
        .from('ksef_invoices')
        .select('transferred_to_invoice_id')
        .eq('id', ksefInvoiceId)
        .maybeSingle();

      if (ksefError) throw ksefError;

      // If transferred, delete the associated invoice file from Google Drive
      if (ksefInvoice?.transferred_to_invoice_id) {
        const { data: invoice, error: invoiceError } = await supabase
          .from('invoices')
          .select('google_drive_id, user_drive_file_id')
          .eq('id', ksefInvoice.transferred_to_invoice_id)
          .maybeSingle();

        if (invoiceError) throw invoiceError;

        const { data: { session } } = await supabase.auth.getSession();

        // Delete from department folder
        if (invoice?.google_drive_id && session) {
          try {
            const deleteResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-from-google-drive`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  fileId: invoice.google_drive_id,
                }),
              }
            );

            if (!deleteResponse.ok) {
              console.error('Failed to delete from department folder:', await deleteResponse.text());
            } else {
              console.log('✓ File deleted from department folder');
            }
          } catch (driveError) {
            console.error('Error deleting from department folder:', driveError);
          }
        }

        // Delete from user's personal folder
        if (invoice?.user_drive_file_id && session) {
          try {
            const deleteResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-from-google-drive`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  fileId: invoice.user_drive_file_id,
                }),
              }
            );

            if (!deleteResponse.ok) {
              console.error('Failed to delete from user folder:', await deleteResponse.text());
            } else {
              console.log('✓ File deleted from user folder');
            }
          } catch (driveError) {
            console.error('Error deleting from user folder:', driveError);
          }
        }

        // Delete the invoice from the system
        const { error: deleteInvoiceError } = await supabase
          .from('invoices')
          .delete()
          .eq('id', ksefInvoice.transferred_to_invoice_id);

        if (deleteInvoiceError) throw deleteInvoiceError;
      }

      // Finally, delete the KSEF invoice
      const { error: deleteError } = await supabase
        .from('ksef_invoices')
        .delete()
        .eq('id', ksefInvoiceId);

      if (deleteError) throw deleteError;

      setSuccessMessage('Faktura została usunięta z systemu KSEF');
      setSelectedInvoice(null);
      await loadInvoices();
    } catch (err: any) {
      console.error('Error deleting KSEF invoice:', err);
      setError(err.message || 'Nie udało się usunąć faktury');
    } finally {
      setLoading(false);
    }
  };

  const handleTransferInvoice = async (departmentId: string, userId?: string) => {
    if (!selectedInvoice || !departmentId) {
      setError('Proszę wybrać dział');
      return;
    }

    console.log('🔄 === ROZPOCZYNAM TRANSFER FAKTURY KSEF ===');
    console.log('Invoice:', selectedInvoice.invoice_number);
    console.log('Department ID:', departmentId);
    console.log('User ID:', userId);

    setTransferring(true);
    setError('');
    setSuccessMessage('');

    try {
      console.log('📄 Pobieranie PDF base64 z faktury KSEF...');
      const { data: ksefData, error: ksefFetchError } = await supabase
        .from('ksef_invoices')
        .select('pdf_base64')
        .eq('id', selectedInvoice.id)
        .maybeSingle();

      if (ksefFetchError) {
        console.error('❌ Błąd pobierania faktury KSEF:', ksefFetchError);
        throw ksefFetchError;
      }

      const base64Pdf = ksefData?.pdf_base64;
      if (!base64Pdf) {
        console.error('❌ Brak PDF base64 w fakturze');
        throw new Error('Brak danych PDF (base64) dla tej faktury. Pobierz faktury ponownie.');
      }
      console.log('✓ Pobrano PDF base64 (długość:', base64Pdf.length, 'znaków)');

      console.log('📂 Pobieranie informacji o dziale...');
      const { data: department, error: folderError } = await supabase
        .from('departments')
        .select('name, google_drive_draft_folder_id')
        .eq('id', departmentId)
        .maybeSingle();

      if (folderError) {
        console.error('❌ Błąd pobierania działu:', folderError);
        throw folderError;
      }
      if (!department) {
        console.error('❌ Nie znaleziono działu');
        throw new Error('Nie znaleziono działu');
      }
      console.log('✓ Znaleziono dział:', department.name);
      console.log('Google Drive folder ID:', department.google_drive_draft_folder_id || 'BRAK');

      // Step 5: Upload PDF to Google Drive (optional, if configured)
      let driveFileUrl = null;
      let googleDriveId = null;

      if (department.google_drive_draft_folder_id) {
        try {
          console.log('📤 Rozpoczynam upload PDF do Google Drive...');
          console.log('Folder ID:', department.google_drive_draft_folder_id);
          console.log('File name:', `${selectedInvoice.invoice_number}.pdf`);
          console.log('Base64 length:', base64Pdf.length);

          if (!user) {
            throw new Error('Brak zalogowanego użytkownika');
          }

          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            throw new Error('No active session');
          }

          const uploadResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-to-google-drive`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                fileName: `${selectedInvoice.invoice_number}.pdf`,
                fileBase64: base64Pdf,
                folderId: department.google_drive_draft_folder_id,
                mimeType: 'application/pdf',
                userId: user.id,
              }),
            }
          );

          console.log('📊 Upload response status:', uploadResponse.status);

          if (uploadResponse.ok) {
            const uploadResult = await uploadResponse.json();
            googleDriveId = uploadResult.fileId;
            driveFileUrl = `https://drive.google.com/file/d/${uploadResult.fileId}/view`;
            console.log('✓ PDF przesłany na Google Drive:', driveFileUrl);
          } else {
            const errorText = await uploadResponse.text();
            console.warn('⚠️ Nie udało się przesłać PDF na Google Drive:', errorText);
            console.warn('Faktura zostanie utworzona bez pliku na Google Drive');
          }
        } catch (uploadError) {
          console.error('❌ Google Drive upload failed:', uploadError);
          console.warn('Faktura zostanie utworzona bez pliku na Google Drive');
        }
      } else {
        console.warn('⚠️ Brak skonfigurowanego folderu Google Drive dla tego działu');
      }

      // Step 6: Get exchange rate if needed
      console.log('💱 Sprawdzanie kursu wymiany...');
      let exchangeRate = 1;
      let plnGrossAmount = selectedInvoice.gross_amount;

      if (selectedInvoice.currency !== 'PLN' && selectedInvoice.issue_date) {
        try {
          console.log(`Pobieranie kursu ${selectedInvoice.currency} na dzień ${selectedInvoice.issue_date}`);
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
            console.log('✓ Kurs wymiany:', exchangeRate, 'PLN =', plnGrossAmount);
          } else {
            console.warn('⚠️ Nie udało się pobrać kursu wymiany, używam 1:1');
          }
        } catch (rateError) {
          console.error('❌ Błąd pobierania kursu wymiany:', rateError);
        }
      } else {
        console.log('✓ Waluta PLN, pomijam pobieranie kursu');
      }

      // Step 7: Find the appropriate approver for this department
      console.log('👤 Szukanie właściwego akceptującego dla działu...');
      let appropriateApproverId = null;

      try {
        // Call the SQL function to get the next approver
        // Pass null as user_role to start workflow from the beginning (Kierownik)
        const { data: approverData, error: approverError } = await supabase
          .rpc('get_next_approver_in_department', {
            dept_id: departmentId,
            user_role: null
          });

        if (approverError) {
          console.error('⚠️ Błąd przy wyszukiwaniu akceptującego:', approverError);
        } else if (approverData) {
          appropriateApproverId = approverData;
          console.log('✓ Znaleziono właściwego akceptującego:', appropriateApproverId);
        } else {
          console.warn('⚠️ Nie znaleziono akceptującego dla działu');
        }
      } catch (err) {
        console.error('⚠️ Błąd przy wywołaniu get_next_approver_in_department:', err);
      }

      // Step 8: Create invoice record with file URL and base64
      console.log('💾 Tworzenie faktury w systemie...');
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
        current_approver_id: appropriateApproverId, // Always use the department's approver
      };

      console.log('✓ Ustawiono akceptującego:', appropriateApproverId || 'BRAK');

      console.log('📝 Dane faktury do zapisu:', {
        invoice_number: invoiceData.invoice_number,
        department_id: invoiceData.department_id,
        status: invoiceData.status,
        has_file_url: !!invoiceData.file_url,
        has_google_drive_id: !!invoiceData.google_drive_id,
        has_pdf_base64: !!invoiceData.pdf_base64,
        pdf_base64_length: invoiceData.pdf_base64?.length || 0
      });

      const { data: newInvoice, error: insertError } = await supabase
        .from('invoices')
        .insert(invoiceData)
        .select()
        .single();

      if (insertError) {
        console.error('❌ Błąd tworzenia faktury:', insertError);
        throw insertError;
      }
      console.log('✓ Faktura utworzona pomyślnie, ID:', newInvoice.id);

      // Step 9: Update KSEF invoice to link it with the created invoice
      console.log('🔗 Aktualizacja linku w KSEF invoice...');
      const { error: updateError } = await supabase
        .from('ksef_invoices')
        .update({
          transferred_to_invoice_id: newInvoice.id,
          transferred_to_department_id: departmentId,
          transferred_at: new Date().toISOString(),
          assigned_to_department_at: new Date().toISOString(),
        })
        .eq('id', selectedInvoice.id);

      if (updateError) {
        console.error('❌ Błąd aktualizacji KSEF invoice:', updateError);
        throw updateError;
      }
      console.log('✓ KSEF invoice zaktualizowany pomyślnie');

      // Step 10: Run OCR on the transferred invoice (only if uploaded to Google Drive)
      if (driveFileUrl) {
        try {
          console.log('🔍 === URUCHAMIANIE OCR DLA FAKTURY KSEF ===');
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
            console.log('✓ OCR zakończone pomyślnie:', ocrData);
          } else {
            const ocrError = await ocrResponse.text();
            console.error('❌ OCR nie powiodło się:', ocrError);
          }
        } catch (ocrError) {
          console.error('❌ Błąd OCR (non-blocking):', ocrError);
        }
      } else {
        console.log('ℹ️ Pomijam OCR - brak pliku na Google Drive');
      }

      console.log('✅ === TRANSFER FAKTURY ZAKOŃCZONY POMYŚLNIE ===');

      let successMsg: string;
      if (driveFileUrl) {
        successMsg = 'Faktura została dodana do Moich Faktur z PDF na Google Drive i przetworzona przez OCR';
      } else if (!department.google_drive_draft_folder_id) {
        successMsg = 'Faktura została dodana do Moich Faktur z PDF. Uwaga: Dział nie ma skonfigurowanego folderu Google Drive dla roboczych faktur.';
      } else {
        successMsg = 'Faktura została dodana do Moich Faktur z PDF. Uwaga: Nie udało się przesłać na Google Drive - sprawdź czy masz połączone konto Google w Konfiguracji.';
      }

      setSuccessMessage(successMsg);
      await loadInvoices();
    } catch (err: any) {
      console.error('❌ === BŁĄD PODCZAS TRANSFERU FAKTURY ===');
      console.error(err);
      setError(err.message || 'Nie udało się przenieść faktury');
    } finally {
      setTransferring(false);
    }
  };

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
              <>
                {canAccessKSEFConfig && lastSync && (
                  <div className="flex flex-col items-end text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span className="text-[11px] font-medium text-text-primary-light dark:text-text-primary-dark">
                        {new Date(lastSync).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                      Kolejna: {Math.floor(nextSyncIn / 60000)}min
                    </div>
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
                      Pobierz nowe faktury
                    </>
                  )}
                </button>
              </>
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
              onClick={() => setInvoiceTab('unassigned')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                invoiceTab === 'unassigned'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
              }`}
            >
              Nieprzypisane ({unassignedCount})
            </button>
            <button
              onClick={() => setInvoiceTab('assigned')}
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
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
          </div>
        ) : invoices.length === 0 ? (
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
          <>
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                    Numer faktury
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider cursor-pointer hover:bg-light-surface dark:hover:bg-dark-surface transition"
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
                    className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider cursor-pointer hover:bg-light-surface dark:hover:bg-dark-surface transition"
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
                    className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider cursor-pointer hover:bg-light-surface dark:hover:bg-dark-surface transition"
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
                        {invoice.transferred_to_invoice_id ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            Przeniesiono
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                            Kliknij aby przenieść
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
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
          onDelete={handleDeleteInvoice}
          transferring={transferring}
        />
      )}
    </div>
  );
}
