import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Upload, FileText, Loader, TrendingUp, Search, X, AlertTriangle, CheckCircle2, RefreshCw, HardDrive, Clock, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { InvoiceList as InvoiceListComponent } from './InvoiceList';
import { InvoiceDetails } from './InvoiceDetails';
import type { Database } from '../../lib/database.types';
import {
  computeFileHash,
  checkDuplicateInDb,
  uploadInvoiceFile,
  validateFiles,
  type FileUploadEntry,
} from '../../lib/uploadUtils';

type Invoice = Database['public']['Tables']['invoices']['Row'];

const SYNC_INTERVAL_MS = 10 * 60 * 1000;

export function InvoiceList() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>(String(currentDate.getFullYear()));
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [uploadQueue, setUploadQueue] = useState<FileUploadEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadValidationError, setUploadValidationError] = useState('');
  const uploadQueueRef = useRef<FileUploadEntry[]>([]);

  const [driveLastSync, setDriveLastSync] = useState<string | null>(null);
  const [driveActive, setDriveActive] = useState(false);
  const [emailLastSync, setEmailLastSync] = useState<string | null>(null);
  const [emailActive, setEmailActive] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [nextSyncIn, setNextSyncIn] = useState<number>(SYNC_INTERVAL_MS);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSyncConfigs = useCallback(async () => {
    if (!user) return;
    const [driveRes, emailRes] = await Promise.all([
      supabase.from('user_drive_configs').select('is_active, last_sync_at').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_email_configs').select('is_active, last_sync_at').eq('user_id', user.id).eq('is_active', true).order('last_sync_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (driveRes.data) {
      setDriveActive(driveRes.data.is_active);
      setDriveLastSync(driveRes.data.last_sync_at);
    }
    if (emailRes.data) {
      setEmailActive(emailRes.data.is_active);
      setEmailLastSync(emailRes.data.last_sync_at);
    }
  }, [user]);

  const runSync = useCallback(async (manual = false) => {
    if (syncing || !user) return;
    setSyncing(true);
    if (manual) setSyncMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji');

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
    if (!driveActive && !emailActive) return;

    syncTimerRef.current = setInterval(() => {
      runSync(false);
    }, SYNC_INTERVAL_MS);

    countdownRef.current = setInterval(() => {
      setNextSyncIn(prev => Math.max(0, prev - 1000));
    }, 1000);

    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [driveActive, emailActive, runSync]);

  const loadInvoices = async () => {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          uploader:profiles!uploaded_by(full_name, role),
          department:departments!department_id(id, name, parent_department_id)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

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
          uploaded_by: null,
          department_id: ksef.transferred_to_department_id,
          file_url: null,
          pdf_base64: null,
          description: 'Faktura z KSEF - wersja robocza',
          pln_gross_amount: ksef.gross_amount,
          exchange_rate: 1,
          created_at: ksef.created_at,
          updated_at: ksef.created_at,
          uploader: null,
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
    } catch (error) {
      console.error('Error loading invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    filterInvoices();
  }, [selectedMonth, selectedYear, selectedStatuses, selectedDepartments, searchQuery, invoices]);

  const filterInvoices = () => {
    let filtered = [...invoices];

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
      filtered = filtered.filter(inv => selectedStatuses.includes(inv.status));
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
  };

  const totalAcceptedAmount = useMemo(() => {
    return filteredInvoices
      .filter(inv => inv.status === 'accepted')
      .reduce((sum, inv) => sum + (Number(inv.pln_gross_amount || inv.gross_amount) || 0), 0);
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
        newEntries.push({
          file, hash,
          status: 'duplicate',
          progress: `Duplikat: ${dbCheck.label}`,
        });
        continue;
      }

      newEntries.push({
        file, hash,
        status: 'pending',
        progress: 'Oczekuje...',
      });
    }

    setUploadQueue(prev => {
      const next = [...prev, ...newEntries];
      uploadQueueRef.current = next;
      return next;
    });

    const hasPending = newEntries.some(e => e.status === 'pending');
    if (hasPending && !isUploading) {
      startUpload([...uploadQueueRef.current]);
    }
  };

  const startUpload = async (snapshot: FileUploadEntry[]) => {
    if (!user) return;
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
        if (dbCheck.isDuplicate) {
          updateEntry(idx, { status: 'duplicate', progress: `Duplikat: ${dbCheck.label}` });
          continue;
        }

        await uploadInvoiceFile(
          entry.file,
          entry.hash,
          user.id,
          (msg) => updateEntry(idx, { progress: msg }),
        );
        updateEntry(idx, { status: 'success', progress: 'Gotowe!' });
      } catch (err: any) {
        updateEntry(idx, {
          status: 'error',
          progress: 'Błąd',
          error: err.message || 'Nieznany błąd',
        });
      }
    }

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
      const { data, error } = await supabase
        .from('departments')
        .select('name')
        .order('name', { ascending: true });

      if (error) throw error;
      setAvailableDepartments(data?.map(d => d.name) || []);
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

  const successCount = uploadQueue.filter(e => e.status === 'success').length;
  const duplicateCount = uploadQueue.filter(e => e.status === 'duplicate').length;
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
    <div className="h-full bg-light-bg dark:bg-dark-bg p-4 overflow-auto">
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
                      : entry.status === 'uploading'
                      ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex-shrink-0">
                    {entry.status === 'uploading' ? (
                      <Loader className="w-4 h-4 text-blue-600 animate-spin" />
                    ) : entry.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : entry.status === 'error' ? (
                      <X className="w-4 h-4 text-red-500" />
                    ) : entry.status === 'duplicate' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
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
                        : entry.status === 'error' ? 'text-red-600 dark:text-red-400'
                        : 'text-text-secondary-light dark:text-text-secondary-dark'
                    }`}>
                      {entry.progress}
                      {entry.error && ` - ${entry.error}`}
                    </span>
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
              { key: 'pending', label: 'W weryfikacji' },
              { key: 'accepted', label: 'Zaakceptowana' },
              { key: 'rejected', label: 'Odrzucona' },
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-ai-accent/10 dark:bg-ai-accent/20 rounded-lg">
              <TrendingUp className="w-4 h-4 text-ai-accent" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark">
                Łączna wartość zaakceptowanych
              </h3>
              <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                Suma zatwierdzonych faktur
              </p>
            </div>
          </div>
          <div className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark font-mono">
            {totalAcceptedAmount.toLocaleString('pl-PL', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            PLN
          </div>
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-3 mb-4">
        <div className="relative">
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

      <InvoiceListComponent
        invoices={filteredInvoices}
        onSelectInvoice={setSelectedInvoice}
      />

      {selectedInvoice && (
        <InvoiceDetails
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onUpdate={loadInvoices}
        />
      )}
    </div>
  );
}
