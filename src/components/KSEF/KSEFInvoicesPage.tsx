import { useState, useEffect, useRef } from 'react';
import { RefreshCw, FileText, AlertCircle, CheckCircle, Settings, ChevronUp, ChevronDown, Clock, Wand2, Calendar, ChevronRight, Search, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { KSEFInvoiceModal } from './KSEFInvoiceModal';
import { KSEFConfiguration } from './KSEFConfiguration';
import { fetchKSEFInvoices, checkKSEFStatus } from '../../lib/ksefApiClient';
import { getAccessibleDepartments } from '../../lib/departmentUtils';

const AURA_HERBALS_NIP = '5851490834';
const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_SYNC_DAYS = 5;

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
  ignored_at: string | null;
  ignored_reason: string | null;
  ignored_by: string | null;
}

interface Department {
  id: string;
  name: string;
}

type MainTabType = 'invoices' | 'configuration';
type InvoiceTabType = 'unassigned' | 'assigned' | 'ignored';
type SortColumn = 'issue_date' | 'gross_amount' | 'supplier_name' | 'department';
type SortDirection = 'asc' | 'desc';

export function KSEFInvoicesPage() {
  const { user, profile } = useAuth();
  const [mainTab, setMainTab] = useState<MainTabType>('invoices');
  const [invoiceTab, setInvoiceTab] = useState<InvoiceTabType>('unassigned');
  const [invoices, setInvoices] = useState<KSEFInvoice[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [assignedCount, setAssignedCount] = useState(0);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<KSEFInvoice | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [ksefStatus, setKsefStatus] = useState<any>(null);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [nextSyncIn, setNextSyncIn] = useState<number>(SYNC_INTERVAL_MS);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const today = new Date().toISOString().split('T')[0];
  const fiveDaysAgo = new Date(Date.now() - DEFAULT_SYNC_DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [customDateFrom, setCustomDateFrom] = useState(fiveDaysAgo);
  const [customDateTo, setCustomDateTo] = useState(today);

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

  const getFilteredInvoices = () => {
    if (!searchQuery.trim()) return invoices;
    const q = searchQuery.trim().toLowerCase();
    return invoices.filter(inv =>
      (inv.supplier_name || '').toLowerCase().includes(q) ||
      (inv.supplier_nip || '').toLowerCase().includes(q) ||
      (inv.invoice_number || '').toLowerCase().includes(q)
    );
  };

  const getSortedInvoices = () => {
    const filtered = getFilteredInvoices();
    if (!sortColumn) return filtered;

    return [...filtered].sort((a, b) => {
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
    setSearchQuery('');
  }, [invoiceTab]);

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setShowDatePicker(false);
      }
    };
    if (showDatePicker) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDatePicker]);

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
      const canSeeAllDepts =
        profile.is_admin ||
        profile.role === 'CEO' ||
        profile.role === 'Dyrektor' ||
        profile.role === 'Kierownik';

      if (canSeeAllDepts) {
        const { data, error } = await supabase
          .from('departments')
          .select('id, name')
          .order('name');
        if (error) throw error;
        setDepartments(data || []);
      } else {
        const accessibleDepts = await getAccessibleDepartments(profile);
        setDepartments(accessibleDepts);
      }
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
        .is('transferred_to_department_id', null)
        .is('ignored_at', null);

      const { count: assigned } = await supabase
        .from('ksef_invoices')
        .select('*', { count: 'exact', head: true })
        .or('transferred_to_invoice_id.not.is.null,transferred_to_department_id.not.is.null')
        .is('ignored_at', null);

      const { count: ignored } = await supabase
        .from('ksef_invoices')
        .select('*', { count: 'exact', head: true })
        .not('ignored_at', 'is', null);

      setUnassignedCount(unassigned || 0);
      setAssignedCount(assigned || 0);
      setIgnoredCount(ignored || 0);

      let query = supabase
        .from('ksef_invoices')
        .select('*');

      if (invoiceTab === 'unassigned') {
        query = query
          .is('transferred_to_invoice_id', null)
          .is('transferred_to_department_id', null)
          .is('ignored_at', null)
          .order('created_at', { ascending: false });
      } else if (invoiceTab === 'assigned') {
        query = query
          .or('transferred_to_invoice_id.not.is.null,transferred_to_department_id.not.is.null')
          .is('ignored_at', null)
          .order('assigned_to_department_at', { ascending: false, nullsFirst: false })
          .order('transferred_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false });
      } else {
        query = query
          .not('ignored_at', 'is', null)
          .order('ignored_at', { ascending: false });
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

  const uploadKsefPdfsToGoogleDrive = async () => {
    try {
      console.log('📤 Rozpoczynam automatyczny upload PDF do Google Drive...');

      // Small delay to allow database transactions to commit
      await new Promise(resolve => setTimeout(resolve, 1000));

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.warn('Brak sesji, pomijam upload PDF');
        return;
      }

      const uploadResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-upload-ksef-pdfs`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );

      if (uploadResponse.ok) {
        const result = await uploadResponse.json();
        console.log('✓ Auto-upload PDF zakończony:', result);
        if (result.successCount > 0) {
          console.log(`✓ Uploadowano ${result.successCount} plików PDF do Google Drive`);
          setSuccessMessage(prev =>
            prev + ` | Uploadowano ${result.successCount} PDF na Google Drive`
          );
          // Reload invoices to show updated google_drive_id
          await loadInvoices();
        }
      } else {
        const errorText = await uploadResponse.text();
        console.warn('⚠️ Nie udało się wykonać auto-upload PDF:', errorText);
      }
    } catch (error) {
      console.error('Błąd podczas auto-upload PDF:', error);
    }
  };

  const handleFetchInvoices = async (overrideDateFrom?: string, overrideDateTo?: string) => {
    setFetching(true);
    setError('');
    setSuccessMessage('');
    setShowDatePicker(false);

    try {
      console.log('=== ROZPOCZYNAM POBIERANIE FAKTUR KSEF ===');
      console.log('Profile ID:', profile?.id);
      console.log('Profile email:', profile?.email);

      const defaultFrom = new Date();
      defaultFrom.setDate(defaultFrom.getDate() - DEFAULT_SYNC_DAYS);
      const dateFromStr = overrideDateFrom || defaultFrom.toISOString().split('T')[0];
      const dateToStr = overrideDateTo || new Date().toISOString().split('T')[0];

      console.log('Zakres dat:', dateFromStr, '-', dateToStr);

      const response = await fetchKSEFInvoices({
        dateFrom: dateFromStr,
        dateTo: dateToStr,
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

      // IMPORTANT: Always upload PDFs to Google Drive after fetching
      // This handles invoices that were auto-transferred by the database trigger
      console.log('🔄 Sprawdzanie czy są faktury do uploadu na Google Drive...');
      await uploadKsefPdfsToGoogleDrive();

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
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/revert-ksef-invoice`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ksefInvoiceId }),
        }
      );

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Nie udało się cofnąć przypisania faktury');
      }

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

  const handleIgnoreInvoice = async (ksefInvoiceId: string, reason: string) => {
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const { error: updateError } = await supabase
        .from('ksef_invoices')
        .update({
          ignored_at: new Date().toISOString(),
          ignored_reason: reason,
          ignored_by: user?.id,
        })
        .eq('id', ksefInvoiceId);

      if (updateError) throw updateError;

      setSuccessMessage('Faktura została przeniesiona na listę ignorowanych');
      setSelectedInvoice(null);
      await loadInvoices();
    } catch (err: any) {
      console.error('Error ignoring invoice:', err);
      setError(err.message || 'Nie udało się zignorować faktury');
    } finally {
      setLoading(false);
    }
  };

  const handleUnignoreInvoice = async (ksefInvoiceId: string) => {
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const { error: updateError } = await supabase
        .from('ksef_invoices')
        .update({
          ignored_at: null,
          ignored_reason: null,
          ignored_by: null,
        })
        .eq('id', ksefInvoiceId);

      if (updateError) throw updateError;

      setSuccessMessage('Faktura została przywrócona do listy nieprzypisanych');
      setSelectedInvoice(null);
      await loadInvoices();
    } catch (err: any) {
      console.error('Error unignoring invoice:', err);
      setError(err.message || 'Nie udało się przywrócić faktury');
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
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshData.session) throw new Error('Brak aktywnej sesji - zaloguj się ponownie');
      }

      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) throw new Error('Brak aktywnej sesji');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transfer-ksef-invoice`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${currentSession.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            ksefInvoiceId: selectedInvoice.id,
            departmentId,
            userId: userId || undefined,
          }),
        }
      );

      let result: any;
      try {
        result = await response.json();
      } catch {
        throw new Error(`Błąd serwera (${response.status}): ${response.statusText}`);
      }

      if (!response.ok || !result.success) {
        throw new Error(result.error || `Błąd serwera (${response.status})`);
      }

      console.log('✅ === TRANSFER FAKTURY ZAKOŃCZONY POMYŚLNIE ===');
      setSuccessMessage('Faktura została dodana do obszaru roboczego');
      await loadInvoices();
    } catch (err: any) {
      console.error('❌ === BŁĄD PODCZAS TRANSFERU FAKTURY ===');
      console.error(err);
      setError(err.message || 'Nie udało się przenieść faktury');
    } finally {
      setTransferring(false);
    }
  };

  const handleAutoAssign = async () => {
    setAutoAssigning(true);
    setError('');
    setSuccessMessage('');

    try {
      const { data: unassigned, error: fetchError } = await supabase
        .from('ksef_invoices')
        .select('id, supplier_nip')
        .is('transferred_to_invoice_id', null)
        .is('transferred_to_department_id', null)
        .is('ignored_at', null)
        .not('supplier_nip', 'is', null);

      if (fetchError) throw fetchError;

      if (!unassigned || unassigned.length === 0) {
        setSuccessMessage('Brak nieprzypisanych faktur do automatycznego przypisania');
        return;
      }

      const { data: mappings, error: mappingsError } = await supabase
        .from('ksef_nip_department_mappings')
        .select('nip, department_id, assigned_user_id');

      if (mappingsError) throw mappingsError;

      const nipMap = new Map<string, { department_id: string; assigned_user_id: string | null }>();
      for (const m of mappings || []) {
        nipMap.set(m.nip, { department_id: m.department_id, assigned_user_id: m.assigned_user_id });
      }

      const toAssign = unassigned.filter(inv => inv.supplier_nip && nipMap.has(inv.supplier_nip));

      if (toAssign.length === 0) {
        setSuccessMessage('Żadna z nieprzypisanych faktur nie pasuje do reguł konfiguracji');
        return;
      }

      let assigned = 0;
      for (const inv of toAssign) {
        const mapping = nipMap.get(inv.supplier_nip!)!;
        const { error: updateError } = await supabase
          .from('ksef_invoices')
          .update({
            transferred_to_department_id: mapping.department_id,
            assigned_to_department_at: new Date().toISOString(),
          })
          .eq('id', inv.id);

        if (!updateError) assigned++;
      }

      setSuccessMessage(`Przypisano ${assigned} z ${toAssign.length} faktur do działów. Przenoszenie do systemu...`);
      await loadInvoices();
      await autoTransferAssignedInvoices();
    } catch (err: any) {
      console.error('Error during auto-assign:', err);
      setError(err.message || 'Nie udało się automatycznie przypisać faktur');
    } finally {
      setAutoAssigning(false);
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
                {invoiceTab === 'unassigned' && (
                  <button
                    onClick={handleAutoAssign}
                    disabled={autoAssigning || fetching}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 text-sm"
                  >
                    {autoAssigning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Przypisywanie...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4" />
                        Auto Przypisywanie
                      </>
                    )}
                  </button>
                )}
                <div className="relative" ref={datePickerRef}>
                  <div className="flex rounded-lg overflow-hidden border border-brand-primary">
                    <button
                      onClick={() => handleFetchInvoices()}
                      disabled={fetching}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white hover:bg-brand-primary/90 transition disabled:opacity-50 text-sm"
                    >
                      {fetching ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Pobieranie...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          Pobierz {DEFAULT_SYNC_DAYS} dni
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowDatePicker(p => !p)}
                      disabled={fetching}
                      title="Wybierz własny zakres dat"
                      className="flex items-center px-2 bg-brand-primary/90 hover:bg-brand-primary/80 border-l border-white/20 text-white transition disabled:opacity-50"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {showDatePicker && (
                    <div className="absolute right-0 top-full mt-1.5 z-50 bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl border border-slate-200 dark:border-slate-700/50 p-4 w-72">
                      <p className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark mb-3">
                        Jednorazowa synchronizacja — wybierz zakres dat
                      </p>
                      <div className="space-y-2.5">
                        <div>
                          <label className="block text-[11px] text-text-secondary-light dark:text-text-secondary-dark mb-1">
                            Od
                          </label>
                          <input
                            type="date"
                            value={customDateFrom}
                            max={customDateTo}
                            onChange={e => setCustomDateFrom(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-light-bg dark:bg-dark-bg text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-text-secondary-light dark:text-text-secondary-dark mb-1">
                            Do
                          </label>
                          <input
                            type="date"
                            value={customDateTo}
                            min={customDateFrom}
                            max={today}
                            onChange={e => setCustomDateTo(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-light-bg dark:bg-dark-bg text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => setShowDatePicker(false)}
                          className="flex-1 px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 text-text-secondary-light dark:text-text-secondary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                        >
                          Anuluj
                        </button>
                        <button
                          onClick={() => handleFetchInvoices(customDateFrom, customDateTo)}
                          disabled={!customDateFrom || !customDateTo}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition disabled:opacity-50 font-medium"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                          Pobierz
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
            {canAccessKSEFConfig && (
              <button
                onClick={() => setInvoiceTab('ignored')}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                  invoiceTab === 'ignored'
                    ? 'bg-slate-600 text-white shadow-sm'
                    : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
                }`}
              >
                Ignorowane ({ignoredCount})
              </button>
            )}
          </div>
        )}

        {mainTab === 'invoices' && (
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Szukaj po dostawcy, NIP lub numerze faktury..."
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition"
              >
                <X className="w-4 h-4" />
              </button>
            )}
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
        ) : getSortedInvoices().length === 0 ? (
          <div className="p-6 text-center">
            <FileText className="w-12 h-12 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-3" />
            {searchQuery ? (
              <>
                <p className="text-text-secondary-light dark:text-text-secondary-dark text-base">
                  Brak wyników dla "{searchQuery}"
                </p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-sm text-brand-primary hover:underline"
                >
                  Wyczyść wyszukiwanie
                </button>
              </>
            ) : (
              <>
                <p className="text-text-secondary-light dark:text-text-secondary-dark text-base">
                  Brak faktur KSEF
                </p>
                <p className="text-text-secondary-light dark:text-text-secondary-dark text-xs mt-1">
                  Kliknij przycisk "Pobierz faktury" aby pobrać faktury z systemu
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {searchQuery && (
              <div className="px-3 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Znaleziono <span className="font-semibold text-text-primary-light dark:text-text-primary-dark">{getSortedInvoices().length}</span> wyników dla "<span className="italic">{searchQuery}</span>"
              </div>
            )}
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
                  {invoiceTab === 'ignored' && (
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                      Powód ignorowania
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
                    {invoiceTab === 'ignored' && (
                      <td className="px-3 py-2">
                        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark italic">
                          {invoice.ignored_reason || '—'}
                        </p>
                        {invoice.ignored_at && (
                          <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                            {new Date(invoice.ignored_at).toLocaleDateString('pl-PL')}
                          </p>
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
          onIgnore={handleIgnoreInvoice}
          onUnignore={handleUnignoreInvoice}
          transferring={transferring}
          canIgnore={canAccessKSEFConfig}
        />
      )}
    </div>
  );
}
