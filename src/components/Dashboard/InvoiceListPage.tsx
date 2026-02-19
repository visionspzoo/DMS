import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Upload, FileText, Loader, TrendingUp, Search, X, AlertTriangle, CheckCircle2, RefreshCw, HardDrive, Clock, Mail, Trash2, Send, Check, XCircle, DollarSign, GitMerge, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { InvoiceList as InvoiceListComponent } from './InvoiceList';
import { InvoiceDetails } from './InvoiceDetails';
import { BulkTransferModal } from './BulkTransferModal';
import { MergeInvoicesModal } from './MergeInvoicesModal';
import type { Database } from '../../lib/database.types';
import {
  computeFileHash,
  checkDuplicateInDb,
  uploadInvoiceFile,
  validateFiles,
  type FileUploadEntry,
} from '../../lib/uploadUtils';
import { getAccessibleDepartments } from '../../lib/departmentUtils';
import { fetchAndUpdateExchangeRates } from '../../lib/exchangeRateUtils';

type Invoice = Database['public']['Tables']['invoices']['Row'];

const SYNC_INTERVAL_MS = 60 * 60 * 1000;

function getUserSpecificStatus(invoice: Invoice, currentUserId: string): string {
  if (invoice.status === 'draft') {
    // Draft jest zawsze wyświetlany jako "Robocze" dla:
    // - Uploadera
    // - Current approver
    // - Przełożonych (Kierownik widzi drafty Specjalistów, Dyrektor widzi drafty Kierowników i Specjalistów)
    // Wszyscy widzą status "Robocze"
    return 'draft';
  }

  if (invoice.status === 'accepted') return 'accepted';
  if (invoice.status === 'rejected') return 'rejected';
  if (invoice.status === 'paid') return 'paid';

  if (invoice.status === 'waiting') {
    if (invoice.current_approver_id === currentUserId) {
      return 'waiting';
    }
    if (invoice.uploaded_by === currentUserId) {
      return 'in_review';
    }
    return 'in_review';
  }

  return invoice.status;
}

export function InvoiceList() {
  const { user, profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 30;
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>(String(currentDate.getFullYear()));
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [uploadQueue, setUploadQueue] = useState<FileUploadEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadValidationError, setUploadValidationError] = useState('');
  const uploadQueueRef = useRef<FileUploadEntry[]>([]);
  const uploadingRef = useRef(false);

  const [driveLastSync, setDriveLastSync] = useState<string | null>(null);
  const [driveActive, setDriveActive] = useState(false);
  const [emailLastSync, setEmailLastSync] = useState<string | null>(null);
  const [emailActive, setEmailActive] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [nextSyncIn, setNextSyncIn] = useState<number>(SYNC_INTERVAL_MS);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runSyncRef = useRef<(manual?: boolean) => Promise<void>>();

  const loadFilterPreferences = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('filter_preferences')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data?.filter_preferences) {
        const prefs = data.filter_preferences;
        if (prefs.selectedYear !== undefined) setSelectedYear(prefs.selectedYear);
        if (prefs.selectedMonth !== undefined) setSelectedMonth(prefs.selectedMonth);
        if (prefs.selectedStatuses !== undefined) setSelectedStatuses(prefs.selectedStatuses);
        if (prefs.selectedDepartments !== undefined) setSelectedDepartments(prefs.selectedDepartments);
        if (prefs.searchQuery !== undefined) setSearchQuery(prefs.searchQuery);
      }
    } catch (error) {
      console.error('Error loading filter preferences:', error);
    } finally {
      setPreferencesLoaded(true);
    }
  }, [user]);

  const saveFilterPreferences = useCallback(async () => {
    if (!user || !preferencesLoaded) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const preferences = {
          selectedYear,
          selectedMonth,
          selectedStatuses,
          selectedDepartments,
          searchQuery,
        };

        const { error } = await supabase
          .from('profiles')
          .update({ filter_preferences: preferences })
          .eq('id', user.id);

        if (error) throw error;
      } catch (error) {
        console.error('Error saving filter preferences:', error);
      }
    }, 500);
  }, [user, preferencesLoaded, selectedYear, selectedMonth, selectedStatuses, selectedDepartments, searchQuery]);

  const loadSyncConfigs = useCallback(async () => {
    if (!user) return;
    try {
      const [driveRes, mappingsRes, emailRes] = await Promise.all([
        supabase.from('user_drive_configs').select('is_active, last_sync_at').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_drive_folder_mappings').select('is_active, last_sync_at').eq('user_id', user.id).eq('is_active', true),
        supabase.from('user_email_configs').select('is_active, last_sync_at').eq('user_id', user.id).eq('is_active', true).order('last_sync_at', { ascending: false }).limit(1).maybeSingle(),
      ]);

      let driveIsActive = false;
      let driveLastSyncDate: string | null = null;

      if (!mappingsRes.error && mappingsRes.data && mappingsRes.data.length > 0) {
        driveIsActive = true;
        let latestMapping = mappingsRes.data[0];
        for (const mapping of mappingsRes.data) {
          if (!latestMapping.last_sync_at || (mapping.last_sync_at && new Date(mapping.last_sync_at) > new Date(latestMapping.last_sync_at))) {
            latestMapping = mapping;
          }
        }
        driveLastSyncDate = latestMapping.last_sync_at;
      } else if (!driveRes.error && driveRes.data) {
        driveIsActive = driveRes.data.is_active;
        driveLastSyncDate = driveRes.data.last_sync_at;
      }

      setDriveActive(driveIsActive);
      setDriveLastSync(driveLastSyncDate);

      if (!emailRes.error && emailRes.data) {
        setEmailActive(emailRes.data.is_active);
        setEmailLastSync(emailRes.data.last_sync_at);
      }
    } catch (error) {
      console.error('Error loading sync configs:', error);
    }
  }, [user]);

  const runSync = useCallback(async (manual = false) => {
    if (syncing || !user) return;
    setSyncing(true);
    if (manual) setSyncMessage(null);

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      let session = currentSession;
      if (!session) throw new Error('Brak sesji');

      const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
      if (expiresAt && Date.now() >= expiresAt - 60 * 1000) {
        const { data: { session: refreshed } } = await supabase.auth.refreshSession();
        if (refreshed) session = refreshed;
      }

      const headers = {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      };

      const promises: Promise<Response>[] = [];

      if (driveActive) {
        promises.push(fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-drive-invoices`, { method: 'POST', headers }));
      }
      if (emailActive) {
        promises.push(fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-email-invoices`, { method: 'POST', headers }));
      }

      if (promises.length === 0) {
        if (manual) setSyncMessage({ type: 'error', text: 'Brak aktywnych zrodel synchronizacji. Skonfiguruj dysk lub email w Konfiguracji.' });
        return;
      }

      const results = await Promise.allSettled(promises);
      let totalSynced = 0;
      let hasError = false;

      const errorMessages: string[] = [];
      const warningMessages: string[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          try {
            const body = await r.value.json();
            console.log('Sync response:', body);
            if (r.value.ok) {
              totalSynced += body.total_synced || body.synced || 0;
              if (body.errors) errorMessages.push(...body.errors);
              if (body.warnings) warningMessages.push(...body.warnings);
            } else {
              hasError = true;
              if (body.error) errorMessages.push(body.error);
            }
          } catch (parseError) {
            console.error('Failed to parse sync response:', parseError);
            hasError = true;
            errorMessages.push('Blad parsowania odpowiedzi z serwera');
          }
        } else {
          hasError = true;
          console.error('Sync promise rejected:', r.reason);
          errorMessages.push(r.reason?.message || 'Synchronizacja nieudana');
        }
      }

      await loadSyncConfigs();
      if (totalSynced > 0) loadInvoices();

      if (manual) {
        const hasErrors = hasError || errorMessages.length > 0;
        const allMessages = [...errorMessages, ...warningMessages];

        setSyncMessage({
          type: hasErrors ? 'error' : warningMessages.length > 0 ? 'error' : 'success',
          text: allMessages.length > 0
            ? allMessages.join(' ')
            : totalSynced > 0
            ? `Zsynchronizowano ${totalSynced} nowych faktur`
            : 'Brak nowych faktur do pobrania',
        });
        setTimeout(() => setSyncMessage(null), 10000);
      }
    } catch (e: any) {
      if (manual) {
        setSyncMessage({ type: 'error', text: e.message || 'Blad synchronizacji' });
        setTimeout(() => setSyncMessage(null), 5000);
      }
    } finally {
      setSyncing(false);
      setNextSyncIn(SYNC_INTERVAL_MS);
    }
  }, [syncing, user, driveActive, emailActive, loadSyncConfigs]);

  useEffect(() => {
    loadFilterPreferences();
  }, [loadFilterPreferences]);

  useEffect(() => {
    loadInvoices();
    loadDepartments();
    loadSyncConfigs();

    const subscription = supabase
      .channel('invoices-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        loadInvoices();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    saveFilterPreferences();
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [saveFilterPreferences]);

  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  useEffect(() => {
    if (!driveActive && !emailActive) return;

    const latestSync = [driveLastSync, emailLastSync]
      .filter(Boolean)
      .map(s => new Date(s!).getTime())
      .sort((a, b) => b - a)[0];

    let initialDelay = SYNC_INTERVAL_MS;
    if (latestSync) {
      const elapsed = Date.now() - latestSync;
      initialDelay = Math.max(0, SYNC_INTERVAL_MS - elapsed);
    }
    setNextSyncIn(initialDelay);

    const startTime = Date.now();

    const initialTimeout = setTimeout(() => {
      runSyncRef.current?.(false);
      syncTimerRef.current = setInterval(() => {
        runSyncRef.current?.(false);
      }, SYNC_INTERVAL_MS);
    }, initialDelay);

    countdownRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const firstCycleRemaining = Math.max(0, initialDelay - elapsed);
      if (firstCycleRemaining > 0) {
        setNextSyncIn(firstCycleRemaining);
      } else {
        const sinceFirstFire = elapsed - initialDelay;
        const remaining = SYNC_INTERVAL_MS - (sinceFirstFire % SYNC_INTERVAL_MS);
        setNextSyncIn(remaining);
      }
    }, 1000);

    return () => {
      clearTimeout(initialTimeout);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [driveActive, emailActive, driveLastSync, emailLastSync]);

  const loadInvoices = async () => {
    try {
      console.log('👤 Current user:', { id: user?.id, role: profile?.role, department_id: profile?.department_id });

      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          uploader:profiles!uploaded_by(full_name, role),
          current_approver:profiles!current_approver_id(full_name, role),
          department:departments!department_id(id, name, parent_department_id),
          is_duplicate,
          duplicate_invoice_ids
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error loading invoices:', error);
        throw error;
      }

      console.log('📊 Loaded invoices from DB:', data?.length || 0);
      console.log('🔍 Google Drive invoices:', data?.filter(i => i.source === 'google_drive').length || 0);
      console.log('📝 Draft invoices:', data?.filter(i => i.status === 'draft').length || 0);
      console.log('👥 My invoices:', data?.filter(i => i.uploaded_by === user?.id).length || 0);

      let allInvoices = data || [];

      const { data: ksefInvoices, error: ksefError } = await supabase
        .from('ksef_invoices')
        .select('*')
        .not('transferred_to_department_id', 'is', null)
        .is('transferred_to_invoice_id', null)
        .order('created_at', { ascending: false });

      if (!ksefError && ksefInvoices && ksefInvoices.length > 0) {
        const deptIds = [...new Set(ksefInvoices.map(k => k.transferred_to_department_id).filter(Boolean))];
        const { data: depts } = await supabase
          .from('departments')
          .select('id, name')
          .in('id', deptIds);

        const deptMap = new Map(depts?.map(d => [d.id, d]) || []);

        const fetcherIds = [...new Set(ksefInvoices.map(k => k.fetched_by).filter(Boolean))];
        const { data: fetchers } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .in('id', fetcherIds);

        const fetcherMap = new Map(fetchers?.map(f => [f.id, f]) || []);

        const convertedKsefInvoices = ksefInvoices.map(ksef => ({
          id: ksef.id,
          invoice_number: ksef.invoice_number,
          supplier_name: ksef.supplier_name || 'Brak nazwy',
          supplier_nip: ksef.supplier_nip,
          gross_amount: ksef.gross_amount,
          net_amount: ksef.net_amount,
          currency: ksef.currency,
          issue_date: ksef.issue_date,
          due_date: null,
          status: 'draft',
          uploaded_by: ksef.fetched_by,
          department_id: ksef.transferred_to_department_id,
          file_url: null,
          pdf_base64: null,
          description: 'Faktura z KSEF - wersja robocza',
          pln_gross_amount: ksef.pln_gross_amount || ksef.gross_amount,
          exchange_rate: ksef.exchange_rate || 1,
          created_at: ksef.created_at,
          updated_at: ksef.created_at,
          source: 'ksef',
          ksef_reference_number: ksef.ksef_reference_number,
          uploader: ksef.fetched_by ? fetcherMap.get(ksef.fetched_by) : null,
          department: ksef.transferred_to_department_id ? deptMap.get(ksef.transferred_to_department_id) : null,
        }));

        allInvoices = [...allInvoices, ...convertedKsefInvoices];
        allInvoices.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }

      setInvoices(allInvoices);
      setFilteredInvoices(allInvoices);

      const years = Array.from(new Set(
        allInvoices?.filter(inv => inv.issue_date).map(inv => new Date(inv.issue_date).getFullYear()) || []
      ));
      setAvailableYears(years.sort((a, b) => b - a));

      fetchAndUpdateExchangeRates(allInvoices).then(updated => {
        if (updated !== allInvoices) {
          setInvoices(updated);
        }
      });
    } catch (error) {
      console.error('Error loading invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.id) {
      filterInvoices();
    }
  }, [selectedMonth, selectedYear, selectedStatuses, selectedDepartments, searchQuery, invoices, profile]);


  const filterInvoices = () => {
    if (!profile?.id) {
      console.log('⚠️ Profile not loaded yet, skipping filter');
      setFilteredInvoices([]);
      return;
    }

    let filtered = [...invoices];

    console.log('🔍 Filtering invoices. Total:', invoices.length, 'Profile ID:', profile.id, 'Role:', profile.role, 'is_admin:', profile.is_admin, 'Department:', profile.department_id);

    if (!profile.is_admin) {
      const isSpecialist = profile.role === 'Specjalista';

      filtered = filtered.filter(inv => {
        const isMyUpload = inv.uploaded_by === profile.id;
        const isMyApproval = inv.current_approver_id === profile.id;
        const isMyDepartment = inv.department_id === profile.department_id;

        if (isSpecialist) {
          return (isMyUpload || isMyApproval) && isMyDepartment;
        }

        if (inv.status === 'draft') {
          return isMyUpload || isMyApproval;
        }

        if (inv.status === 'waiting' || inv.status === 'pending' || inv.status === 'in_review') {
          return isMyUpload || isMyApproval || isMyDepartment;
        }

        if (inv.status === 'rejected' || inv.status === 'accepted' || inv.status === 'paid') {
          return isMyUpload || isMyDepartment;
        }

        return false;
      });
      console.log('✅ After user filter:', filtered.length);
    } else {
      // Admin sees all invoices
    }

    if (selectedYear !== 'all') {
      filtered = filtered.filter(inv =>
        inv.issue_date && new Date(inv.issue_date).getFullYear().toString() === selectedYear
      );
    }

    if (selectedMonth !== 'all') {
      filtered = filtered.filter(inv =>
        inv.issue_date && (new Date(inv.issue_date).getMonth() + 1).toString() === selectedMonth
      );
    }

    if (selectedStatuses.length > 0) {
      filtered = filtered.filter(inv => {
        const status = getUserSpecificStatus(inv, profile?.id || '');
        return selectedStatuses.includes(status);
      });
    }

    if (selectedDepartments.length > 0) {
      filtered = filtered.filter(inv => inv.department?.name && selectedDepartments.includes(inv.department.name));
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(inv =>
        inv.invoice_number?.toLowerCase().includes(query) ||
        inv.supplier_name?.toLowerCase().includes(query) ||
        inv.supplier_nip?.toLowerCase().includes(query) ||
        inv.description?.toLowerCase().includes(query) ||
        inv.uploader?.full_name?.toLowerCase().includes(query)
      );
    }

    setFilteredInvoices(filtered);
    setCurrentPage(1);
  };

  const paginatedInvoices = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredInvoices.slice(start, start + PAGE_SIZE);
  }, [filteredInvoices, currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));

  const { totalAcceptedAmount, totalPaidAmount, currencyBreakdownAccepted, currencyBreakdownPaid } = useMemo(() => {
    const accepted = filteredInvoices.filter(inv => inv.status === 'accepted');
    const paid = filteredInvoices.filter(inv => inv.status === 'paid');

    const buildBreakdown = (invoices: typeof filteredInvoices) => {
      const byCurrency: Record<string, { total: number; count: number }> = {};
      for (const inv of invoices) {
        const cur = inv.currency || 'PLN';
        if (!byCurrency[cur]) byCurrency[cur] = { total: 0, count: 0 };
        byCurrency[cur].total += Number(inv.gross_amount) || 0;
        byCurrency[cur].count++;
      }
      return Object.entries(byCurrency)
        .filter(([cur]) => cur !== 'PLN')
        .sort(([a], [b]) => a.localeCompare(b));
    };

    const sumPln = (invoices: typeof filteredInvoices) =>
      invoices.reduce((sum, inv) => sum + (Number(inv.pln_gross_amount || inv.gross_amount) || 0), 0);

    return {
      totalAcceptedAmount: sumPln(accepted),
      totalPaidAmount: sumPln(paid),
      currencyBreakdownAccepted: buildBreakdown(accepted),
      currencyBreakdownPaid: buildBreakdown(paid),
    };
  }, [filteredInvoices]);

  const updateEntry = (index: number, update: Partial<FileUploadEntry>) => {
    setUploadQueue(prev => {
      const next = prev.map((e, i) => i === index ? { ...e, ...update } : e);
      uploadQueueRef.current = next;
      return next;
    });
  };

  const addFilesToQueue = async (rawFiles: File[]) => {
    if (!user) return;

    const { valid, errors } = validateFiles(rawFiles);
    if (errors.length > 0) {
      setUploadValidationError(errors.join('; '));
      setTimeout(() => setUploadValidationError(''), 6000);
    }
    if (valid.length === 0) return;

    const newEntries: FileUploadEntry[] = [];
    for (const file of valid) {
      const hash = await computeFileHash(file);

      const alreadyInQueue = uploadQueueRef.current.some(e => e.hash === hash);
      if (alreadyInQueue) {
        newEntries.push({
          file, hash,
          status: 'duplicate',
          progress: 'Duplikat w tej partii',
        });
        continue;
      }

      const dbCheck = await checkDuplicateInDb(hash, user.id);
      if (dbCheck.isDuplicate) {
        if (dbCheck.isOtherDepartment) {
          newEntries.push({
            file, hash,
            status: 'pending',
            progress: `OSTRZEŻENIE: Duplikat w dziale "${dbCheck.departmentName}" (dodane przez: ${dbCheck.uploaderName})`,
            duplicateInfo: {
              departmentName: dbCheck.departmentName || 'Nieznany dział',
              uploaderName: dbCheck.uploaderName || 'Nieznany użytkownik',
              invoiceNumber: dbCheck.invoiceNumber,
            },
          });
        } else {
          newEntries.push({
            file, hash,
            status: 'duplicate',
            progress: `Duplikat: ${dbCheck.label}`,
          });
          continue;
        }
      } else {
        newEntries.push({
          file, hash,
          status: 'pending',
          progress: 'Oczekuje...',
        });
      }
    }

    const next = [...uploadQueueRef.current, ...newEntries];
    uploadQueueRef.current = next;
    setUploadQueue(next);

    const hasPending = newEntries.some(e => e.status === 'pending');
    if (hasPending && !uploadingRef.current) {
      startUpload([...next]);
    }
  };

  const startUpload = async (snapshot: FileUploadEntry[]) => {
    if (!user || uploadingRef.current) return;
    uploadingRef.current = true;
    setIsUploading(true);

    const pendingIndices: number[] = [];
    snapshot.forEach((e, i) => {
      if (e.status === 'pending') pendingIndices.push(i);
    });

    for (const idx of pendingIndices) {
      const entry = uploadQueueRef.current[idx];
      if (!entry || entry.status !== 'pending') continue;

      updateEntry(idx, { status: 'uploading', progress: 'Sprawdzanie...' });

      try {
        const dbCheck = await checkDuplicateInDb(entry.hash, user.id);
        if (dbCheck.isDuplicate && !dbCheck.isOtherDepartment) {
          updateEntry(idx, { status: 'duplicate', progress: `Duplikat: ${dbCheck.label}` });
          continue;
        }

        const hasDuplicateWarning = dbCheck.isDuplicate && dbCheck.isOtherDepartment;
        if (hasDuplicateWarning) {
          updateEntry(idx, {
            progress: `⚠️ Duplikat w "${dbCheck.departmentName}" - przesyłanie...`,
            duplicateInfo: {
              departmentName: dbCheck.departmentName || 'Nieznany dział',
              uploaderName: dbCheck.uploaderName || 'Nieznany użytkownik',
              invoiceNumber: dbCheck.invoiceNumber,
            },
          });
        }

        await uploadInvoiceFile(
          entry.file,
          entry.hash,
          user.id,
          (msg) => updateEntry(idx, { progress: hasDuplicateWarning ? `⚠️ Duplikat w innym dziale - ${msg}` : msg }),
        );

        if (hasDuplicateWarning) {
          updateEntry(idx, {
            status: 'duplicate_other_department',
            progress: `Przesłano (duplikat w dziale: ${dbCheck.departmentName})`,
            duplicateInfo: {
              departmentName: dbCheck.departmentName || 'Nieznany dział',
              uploaderName: dbCheck.uploaderName || 'Nieznany użytkownik',
              invoiceNumber: dbCheck.invoiceNumber,
            },
          });
        } else {
          updateEntry(idx, { status: 'success', progress: 'Gotowe!' });
        }
      } catch (err: any) {
        updateEntry(idx, {
          status: 'error',
          progress: 'Błąd',
          error: err.message || 'Nieznany błąd',
        });
      }
    }

    uploadingRef.current = false;
    setIsUploading(false);
    loadInvoices();
  };

  const clearQueue = () => {
    setUploadQueue([]);
    uploadQueueRef.current = [];
  };

  const removeFromQueue = (index: number) => {
    setUploadQueue(prev => {
      const next = prev.filter((_, i) => i !== index);
      uploadQueueRef.current = next;
      return next;
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await addFilesToQueue(files);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await addFilesToQueue(files);
    }
    e.target.value = '';
  };

  const loadDepartments = async () => {
    try {
      if (!profile) return;

      const accessibleDepts = await getAccessibleDepartments(profile);
      setAvailableDepartments(accessibleDepts.map(d => d.name));
    } catch (error) {
      console.error('Error loading departments:', error);
    }
  };

  const toggleDepartment = (dept: string) => {
    setSelectedDepartments(prev =>
      prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]
    );
  };

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  const toggleSelectInvoice = (invoiceId: string) => {
    setSelectedInvoiceIds(prev =>
      prev.includes(invoiceId) ? prev.filter(id => id !== invoiceId) : [...prev, invoiceId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedInvoiceIds.length === filteredInvoices.length) {
      setSelectedInvoiceIds([]);
    } else {
      setSelectedInvoiceIds(filteredInvoices.map(inv => inv.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedInvoiceIds.length === 0) return;

    const confirmMsg = `Czy na pewno chcesz usunąć ${selectedInvoiceIds.length} faktur?`;
    if (!confirm(confirmMsg)) return;

    setBulkActionLoading(true);
    try {
      const { error } = await supabase
        .from('invoices')
        .delete()
        .in('id', selectedInvoiceIds);

      if (error) throw error;

      setSelectedInvoiceIds([]);
      setSelectionMode(false);
      loadInvoices();
    } catch (error: any) {
      alert('Błąd podczas usuwania faktur: ' + error.message);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkTransfer = () => {
    if (selectedInvoiceIds.length === 0) return;
    setShowTransferModal(true);
  };

  const handleBulkAccept = async () => {
    if (selectedInvoiceIds.length === 0) return;

    const confirmMsg = `Czy na pewno chcesz zaakceptować ${selectedInvoiceIds.length} faktur?`;
    if (!confirm(confirmMsg)) return;

    setBulkActionLoading(true);
    try {
      const selectedInvs = filteredInvoices.filter(inv => selectedInvoiceIds.includes(inv.id));

      for (const invoice of selectedInvs) {
        if (invoice.current_approver_id !== profile?.id && !profile?.is_admin) {
          continue;
        }

        const { error } = await supabase
          .from('invoices')
          .update({
            status: 'accepted',
            current_approver_id: null,
          })
          .eq('id', invoice.id);

        if (error) throw error;
      }

      setSelectedInvoiceIds([]);
      setSelectionMode(false);
      loadInvoices();
    } catch (error: any) {
      alert('Błąd podczas akceptacji faktur: ' + error.message);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedInvoiceIds.length === 0) return;

    const reason = prompt('Podaj powód odrzucenia (opcjonalnie):');
    if (reason === null) return;

    const confirmMsg = `Czy na pewno chcesz odrzucić ${selectedInvoiceIds.length} faktur?`;
    if (!confirm(confirmMsg)) return;

    setBulkActionLoading(true);
    try {
      const selectedInvs = filteredInvoices.filter(inv => selectedInvoiceIds.includes(inv.id));

      for (const invoice of selectedInvs) {
        if (invoice.current_approver_id !== profile?.id && !profile?.is_admin) {
          continue;
        }

        const { error } = await supabase
          .from('invoices')
          .update({
            status: 'rejected',
            current_approver_id: null,
            description: reason ? `${invoice.description || ''}\nOdrzucono: ${reason}`.trim() : invoice.description,
          })
          .eq('id', invoice.id);

        if (error) throw error;
      }

      setSelectedInvoiceIds([]);
      setSelectionMode(false);
      loadInvoices();
    } catch (error: any) {
      alert('Błąd podczas odrzucania faktur: ' + error.message);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkMarkAsPaid = async () => {
    if (selectedInvoiceIds.length === 0) return;

    const confirmMsg = `Czy na pewno chcesz oznaczyć ${selectedInvoiceIds.length} faktur jako opłacone?`;
    if (!confirm(confirmMsg)) return;

    setBulkActionLoading(true);
    try {
      const selectedInvs = filteredInvoices.filter(inv => selectedInvoiceIds.includes(inv.id));

      for (const invoice of selectedInvs) {
        const canMark =
          invoice.status !== 'paid' && (
            profile?.is_admin ||
            profile?.role === 'dyrektor' ||
            (invoice.status === 'draft' && invoice.uploaded_by === profile?.id) ||
            invoice.status === 'accepted'
          );
        if (!canMark) continue;

        const { error } = await supabase
          .from('invoices')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            paid_by: profile?.id,
          })
          .eq('id', invoice.id);

        if (error) throw error;
      }

      setSelectedInvoiceIds([]);
      setSelectionMode(false);
      loadInvoices();
    } catch (error: any) {
      alert('Błąd podczas oznaczania faktur jako opłacone: ' + error.message);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const canApproveSelected = useMemo(() => {
    if (selectedInvoiceIds.length === 0) return false;
    const selectedInvs = filteredInvoices.filter(inv => selectedInvoiceIds.includes(inv.id));
    return selectedInvs.some(inv =>
      (inv.current_approver_id === profile?.id || profile?.is_admin) &&
      (inv.status === 'waiting' || inv.status === 'pending')
    );
  }, [selectedInvoiceIds, filteredInvoices, profile]);

  const canMarkAsPaidSelected = useMemo(() => {
    if (selectedInvoiceIds.length === 0) return false;
    const selectedInvs = filteredInvoices.filter(inv => selectedInvoiceIds.includes(inv.id));
    return selectedInvs.some(inv =>
      inv.status !== 'paid' && (
        profile?.is_admin ||
        profile?.role === 'dyrektor' ||
        (inv.status === 'draft' && inv.uploaded_by === profile?.id) ||
        inv.status === 'accepted'
      )
    );
  }, [selectedInvoiceIds, filteredInvoices, profile]);

  const successCount = uploadQueue.filter(e => e.status === 'success').length;
  const duplicateCount = uploadQueue.filter(e => e.status === 'duplicate').length;
  const duplicateOtherDeptCount = uploadQueue.filter(e => e.status === 'duplicate_other_department').length;
  const errorCount = uploadQueue.filter(e => e.status === 'error').length;
  const queueDone = uploadQueue.length > 0 && !isUploading && uploadQueue.every(e => e.status !== 'pending');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  return (
    <div className={`h-full bg-light-bg dark:bg-dark-bg p-4 overflow-auto ${selectionMode && selectedInvoiceIds.length > 0 ? 'pb-28' : ''}`}>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Faktury w Obiegu</h1>
        <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
          {filteredInvoices.length} z {invoices.length} {invoices.length === 1 ? 'faktury' : 'faktur'}
        </p>
      </div>

      {(driveActive || emailActive) && (
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-wrap">
              {driveActive && (
                <div className="flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
                    Dysk:
                  </span>
                  <span className="text-[11px] font-medium text-text-primary-light dark:text-text-primary-dark">
                    {driveLastSync
                      ? new Date(driveLastSync).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : 'nigdy'}
                  </span>
                </div>
              )}
              {emailActive && (
                <div className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                  <span className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
                    Email:
                  </span>
                  <span className="text-[11px] font-medium text-text-primary-light dark:text-text-primary-dark">
                    {emailLastSync
                      ? new Date(emailLastSync).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : 'nigdy'}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  Nastepna za {Math.floor(nextSyncIn / 60000)}:{String(Math.floor((nextSyncIn % 60000) / 1000)).padStart(2, '0')}
                </span>
              </div>
            </div>
            <button
              onClick={() => runSync(true)}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Synchronizacja...' : 'Synchronizuj teraz'}
            </button>
          </div>
          {syncMessage && (
            <div className={`mt-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium ${
              syncMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}>
              {syncMessage.text}
            </div>
          )}
        </div>
      )}

      <div
        className={`bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border-2 transition-colors mb-4 overflow-hidden ${
          dragActive
            ? 'border-brand-primary dark:border-brand-primary bg-brand-primary/5 dark:bg-brand-primary/10'
            : isUploading
            ? 'border-brand-primary dark:border-brand-primary'
            : 'border-dashed border-slate-300 dark:border-slate-600/50 hover:border-brand-primary/30 dark:hover:border-brand-primary/30'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {uploadQueue.length === 0 ? (
          <div
            className="p-6 text-center cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center gap-2">
              <div className={`p-3 rounded-full transition-colors ${
                dragActive
                  ? 'bg-brand-primary/20 dark:bg-brand-primary/30'
                  : 'bg-light-surface-variant dark:bg-dark-surface-variant'
              }`}>
                <FileText className={`w-6 h-6 transition-colors ${
                  dragActive
                    ? 'text-brand-primary'
                    : 'text-text-secondary-light dark:text-text-secondary-dark'
                }`} />
              </div>
              <div>
                {uploadValidationError ? (
                  <>
                    <p className="text-sm font-semibold text-status-error mb-0.5">Błąd!</p>
                    <p className="text-xs text-status-error">{uploadValidationError}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-0.5">
                      {dragActive ? 'Upuść pliki tutaj' : 'Kliknij lub przeciągnij pliki'}
                    </p>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      PDF, JPG, PNG (max 10MB) -- możesz wybrać wiele plików naraz
                    </p>
                  </>
                )}
              </div>
              {!uploadValidationError && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg transition-colors font-medium text-sm"
                >
                  <Upload className="w-4 h-4" />
                  Dodaj faktury
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4">
            {queueDone && (
              <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-semibold text-green-900 dark:text-green-300">
                    Zakończono
                    {successCount > 0 && ` -- przesłano: ${successCount}`}
                    {duplicateCount > 0 && ` -- duplikaty: ${duplicateCount}`}
                    {duplicateOtherDeptCount > 0 && ` -- duplikaty w innych działach: ${duplicateOtherDeptCount}`}
                    {errorCount > 0 && ` -- błędy: ${errorCount}`}
                  </span>
                </div>
                <button
                  onClick={clearQueue}
                  className="text-xs font-medium text-green-700 dark:text-green-400 hover:underline"
                >
                  Zamknij
                </button>
              </div>
            )}

            <div className="max-h-48 overflow-y-auto space-y-1.5 mb-3">
              {uploadQueue.map((entry, idx) => (
                <div
                  key={`${entry.hash}-${idx}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
                    entry.status === 'success'
                      ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                      : entry.status === 'error'
                      ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                      : entry.status === 'duplicate'
                      ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                      : entry.status === 'duplicate_other_department'
                      ? 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800'
                      : entry.status === 'uploading'
                      ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800'
                      : entry.duplicateInfo
                      ? 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex-shrink-0">
                    {entry.status === 'uploading' ? (
                      <Loader className="w-4 h-4 text-blue-600 animate-spin" />
                    ) : entry.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : entry.status === 'duplicate_other_department' ? (
                      <div className="relative">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <AlertTriangle className="w-2.5 h-2.5 text-orange-500 absolute -top-0.5 -right-0.5 bg-white dark:bg-slate-800 rounded-full" />
                      </div>
                    ) : entry.status === 'error' ? (
                      <X className="w-4 h-4 text-red-500" />
                    ) : entry.status === 'duplicate' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    ) : entry.duplicateInfo ? (
                      <AlertTriangle className="w-4 h-4 text-orange-500" />
                    ) : (
                      <FileText className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-text-primary-light dark:text-text-primary-dark truncate block text-xs">
                      {entry.file.name}
                    </span>
                    <span className={`text-[11px] ${
                      entry.status === 'duplicate' ? 'text-amber-600 dark:text-amber-400'
                        : entry.status === 'duplicate_other_department' ? 'text-orange-600 dark:text-orange-400'
                        : entry.status === 'error' ? 'text-red-600 dark:text-red-400'
                        : entry.duplicateInfo ? 'text-orange-600 dark:text-orange-400'
                        : 'text-text-secondary-light dark:text-text-secondary-dark'
                    }`}>
                      {entry.progress}
                      {entry.error && ` - ${entry.error}`}
                    </span>
                    {(entry.status === 'duplicate_other_department' || (entry.duplicateInfo && entry.status === 'pending')) && entry.duplicateInfo && (
                      <div className="mt-0.5 text-[10px] text-orange-700 dark:text-orange-300 font-medium">
                        {entry.duplicateInfo.invoiceNumber && `Nr faktury: ${entry.duplicateInfo.invoiceNumber} • `}
                        Dział: {entry.duplicateInfo.departmentName} • Dodane przez: {entry.duplicateInfo.uploaderName}
                      </div>
                    )}
                  </div>
                  {!isUploading && entry.status !== 'uploading' && !queueDone && (
                    <button
                      onClick={() => removeFromQueue(idx)}
                      className="p-0.5 hover:bg-white/60 dark:hover:bg-white/10 rounded flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {!queueDone && (
              <div className="flex gap-2">
                <label className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition font-medium text-center cursor-pointer text-xs">
                  Dodaj więcej
                  <input
                    type="file"
                    onChange={handleFileSelect}
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    multiple
                    disabled={isUploading}
                  />
                </label>
                {!isUploading && (
                  <button
                    onClick={clearQueue}
                    className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  >
                    Anuluj
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          multiple
        />
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-3 mb-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">Status:</label>
            {[
              { key: 'draft', label: 'Robocze' },
              { key: 'waiting', label: 'Oczekujące' },
              { key: 'in_review', label: 'W weryfikacji' },
              { key: 'accepted', label: 'Zaakceptowana' },
              { key: 'rejected', label: 'Odrzucona' },
              { key: 'paid', label: 'Opłacona' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => toggleStatus(key)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  selectedStatuses.includes(key)
                    ? 'bg-brand-primary text-white'
                    : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
                }`}
              >
                {label}
              </button>
            ))}
            {availableDepartments.length > 0 && (
              <>
                <div className="h-4 w-px bg-slate-300 dark:bg-slate-600 mx-1"></div>
                <label className="text-xs text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">Działy:</label>
                {availableDepartments.map(dept => (
                  <button
                    key={dept}
                    onClick={() => toggleDepartment(dept)}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                      selectedDepartments.includes(dept)
                        ? 'bg-brand-primary text-white'
                        : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
                    }`}
                  >
                    {dept}
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Rok:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark"
              >
                <option value="all">Wszystkie</option>
                {availableYears.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Miesiąc:</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark"
              >
                <option value="all">Wszystkie</option>
                <option value="1">Styczeń</option>
                <option value="2">Luty</option>
                <option value="3">Marzec</option>
                <option value="4">Kwiecień</option>
                <option value="5">Maj</option>
                <option value="6">Czerwiec</option>
                <option value="7">Lipiec</option>
                <option value="8">Sierpień</option>
                <option value="9">Wrzesień</option>
                <option value="10">Październik</option>
                <option value="11">Listopad</option>
                <option value="12">Grudzień</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-lg">
                <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark">
                  Zaakceptowane
                </h3>
                <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  Suma zatwierdzonych
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark font-mono">
                {totalAcceptedAmount.toLocaleString('pl-PL', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                PLN
              </div>
              {currencyBreakdownAccepted.length > 0 && (
                <div className="mt-1 flex flex-wrap justify-end gap-x-3 gap-y-0.5">
                  {currencyBreakdownAccepted.map(([cur, data]) => (
                    <div key={cur} className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark font-mono">
                      <span className="font-semibold text-text-primary-light dark:text-text-primary-dark">
                        {data.total.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between sm:border-l sm:border-slate-200 sm:dark:border-slate-700/50 sm:pl-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark">
                  Opłacone
                </h3>
                <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  Suma opłaconych
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark font-mono">
                {totalPaidAmount.toLocaleString('pl-PL', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                PLN
              </div>
              {currencyBreakdownPaid.length > 0 && (
                <div className="mt-1 flex flex-wrap justify-end gap-x-3 gap-y-0.5">
                  {currencyBreakdownPaid.map(([cur, data]) => (
                    <div key={cur} className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark font-mono">
                      <span className="font-semibold text-text-primary-light dark:text-text-primary-dark">
                        {data.total.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {!selectionMode ? (
              <>
                <button
                  onClick={() => setSelectionMode(true)}
                  className="px-3 py-1.5 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg transition-colors font-medium text-sm whitespace-nowrap"
                >
                  Zaznacz wiele
                </button>
                <button
                  onClick={() => setShowMergeModal(true)}
                  className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors font-medium text-sm whitespace-nowrap flex items-center gap-1.5"
                >
                  <GitMerge className="w-3.5 h-3.5" />
                  Połącz duplikaty
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setSelectionMode(false);
                    setSelectedInvoiceIds([]);
                  }}
                  className="px-3 py-1.5 bg-slate-500 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium text-sm whitespace-nowrap"
                >
                  Anuluj
                </button>
                <button
                  onClick={toggleSelectAll}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-medium text-sm whitespace-nowrap"
                >
                  {selectedInvoiceIds.length === filteredInvoices.length ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
                </button>
                {selectedInvoiceIds.length > 0 && (
                  <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">
                    Zaznaczono: <span className="font-semibold text-brand-primary">{selectedInvoiceIds.length}</span>
                  </span>
                )}
              </>
            )}
          </div>

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            <input
              type="text"
              placeholder="Szukaj faktur po numerze, dostawcy, NIP, opisie lub osobie przesyłającej..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
            />
          </div>
        </div>
      </div>

      <InvoiceListComponent
        invoices={paginatedInvoices}
        onSelectInvoice={setSelectedInvoice}
        selectedInvoices={selectedInvoiceIds}
        onToggleSelect={toggleSelectInvoice}
        selectionMode={selectionMode}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Wyświetlanie <span className="font-medium text-text-primary-light dark:text-text-primary-dark">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredInvoices.length)}</span> z <span className="font-medium text-text-primary-light dark:text-text-primary-dark">{filteredInvoices.length}</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              <ChevronLeft className="w-4 h-4 text-text-primary-light dark:text-text-primary-dark" />
            </button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let page: number;
              if (totalPages <= 7) {
                page = i + 1;
              } else if (currentPage <= 4) {
                page = i + 1;
              } else if (currentPage >= totalPages - 3) {
                page = totalPages - 6 + i;
              } else {
                page = currentPage - 3 + i;
              }
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition ${
                    currentPage === page
                      ? 'bg-brand-primary text-white'
                      : 'border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {page}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              <ChevronRight className="w-4 h-4 text-text-primary-light dark:text-text-primary-dark" />
            </button>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <InvoiceDetails
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onUpdate={loadInvoices}
        />
      )}

      {showTransferModal && selectedInvoiceIds.length > 0 && (
        <BulkTransferModal
          invoiceIds={selectedInvoiceIds}
          onClose={() => {
            setShowTransferModal(false);
          }}
          onTransferComplete={() => {
            setShowTransferModal(false);
            setSelectedInvoiceIds([]);
            setSelectionMode(false);
            loadInvoices();
          }}
        />
      )}

      {showMergeModal && (
        <MergeInvoicesModal
          invoices={filteredInvoices}
          onClose={() => setShowMergeModal(false)}
          onMergeComplete={() => {
            setShowMergeModal(false);
            loadInvoices();
          }}
        />
      )}

      {selectionMode && selectedInvoiceIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-light-surface dark:bg-dark-surface border-t-2 border-brand-primary dark:border-brand-primary shadow-2xl z-50">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setSelectionMode(false);
                    setSelectedInvoiceIds([]);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-500 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium text-sm shadow-sm"
                >
                  <X className="w-4 h-4" />
                  Anuluj
                </button>
                <div className="flex items-center gap-2 px-3 py-2 bg-brand-primary/10 dark:bg-brand-primary/20 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-brand-primary" />
                  <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                    Zaznaczono: <span className="text-brand-primary">{selectedInvoiceIds.length}</span>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleBulkTransfer}
                  disabled={bulkActionLoading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 shadow-sm"
                >
                  <Send className="w-4 h-4" />
                  Prześlij
                </button>

                {canApproveSelected && (
                  <>
                    <button
                      onClick={handleBulkAccept}
                      disabled={bulkActionLoading}
                      className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 shadow-sm"
                    >
                      <Check className="w-4 h-4" />
                      Zaakceptuj
                    </button>
                    <button
                      onClick={handleBulkReject}
                      disabled={bulkActionLoading}
                      className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 shadow-sm"
                    >
                      <XCircle className="w-4 h-4" />
                      Odrzuć
                    </button>
                  </>
                )}

                <button
                  onClick={handleBulkMarkAsPaid}
                  disabled={bulkActionLoading || !canMarkAsPaidSelected}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 shadow-sm"
                  title={!canMarkAsPaidSelected ? 'Zaznacz faktury ze statusem "Zaakceptowana"' : ''}
                >
                  <DollarSign className="w-4 h-4" />
                  Oznacz jako opłacone
                </button>

                <button
                  onClick={handleBulkDelete}
                  disabled={bulkActionLoading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 shadow-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  Usuń
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
