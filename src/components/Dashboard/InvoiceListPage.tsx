import { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, Upload, FileText, Loader, TrendingUp, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { InvoiceList as InvoiceListComponent } from './InvoiceList';
import { InvoiceDetails } from './InvoiceDetails';
import { UploadInvoice } from './UploadInvoice';
import type { Database } from '../../lib/database.types';

type Invoice = Database['public']['Tables']['invoices']['Row'];

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
  const [showUpload, setShowUpload] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadInvoices();
    loadDepartments();

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

      if (error) {
        console.error('Supabase request failed', error);
        throw error;
      }

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

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      await handleFileUpload(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      handleFileUpload(files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!user) return;

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
      setTimeout(() => setUploadError(''), 5000);
      return;
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Nieprawidłowy format pliku. Dozwolone: PDF, JPG, PNG');
      setTimeout(() => setUploadError(''), 5000);
      return;
    }

    setUploading(true);
    setUploadError('');
    setUploadProgress('Przesyłanie pliku...');

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `invoices/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      setUploadProgress('Konwertowanie do base64...');

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const pdfBase64 = await base64Promise;

      setUploadProgress('Zapisywanie w bazie danych...');

      const { data: invoiceData, error: insertError } = await supabase
        .from('invoices')
        .insert({
          file_url: publicUrl,
          pdf_base64: file.type === 'application/pdf' ? pdfBase64 : null,
          uploaded_by: user.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      setUploadProgress('Wysyłanie do Google Drive...');

      const driveResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-to-google-drive`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileUrl: publicUrl,
            fileName: file.name,
            invoiceId: invoiceData.id,
          }),
        }
      );

      if (!driveResponse.ok) {
        console.error('Google Drive upload failed:', await driveResponse.text());
      }

      setUploadProgress('Przetwarzanie OCR...');

      const ocrResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-invoice-ocr`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileUrl: publicUrl,
            invoiceId: invoiceData.id,
          }),
        }
      );

      if (!ocrResponse.ok) {
        const errorText = await ocrResponse.text();
        console.error('OCR processing failed:', errorText);
      } else {
        const ocrResult = await ocrResponse.json();
        console.log('OCR result:', ocrResult);
        if (ocrResult.usedApi) {
          console.log(`✓ Użyto ${ocrResult.usedApi}`);
        }
        if (ocrResult.error) {
          console.warn('OCR warning:', ocrResult.error);
        }

        if (ocrResult.suggestedTags && ocrResult.suggestedTags.length > 0) {
          console.log('Auto-applying suggested tags...');
          setUploadProgress('Przypisywanie tagów...');

          const autoAppliedTags: string[] = [];
          for (const tag of ocrResult.suggestedTags) {
            try {
              const { error: tagError } = await supabase
                .from('invoice_tags')
                .insert({
                  invoice_id: invoiceData.id,
                  tag_id: tag.id,
                  created_by: user?.id,
                });

              if (!tagError) {
                autoAppliedTags.push(tag.name);
                console.log(`✓ Auto-applied tag: ${tag.name}`);
              }
            } catch (tagErr) {
              console.error(`Error auto-applying tag ${tag.name}:`, tagErr);
            }
          }

          if (autoAppliedTags.length > 0) {
            setUploadProgress(`Gotowe! Dodano tagi: ${autoAppliedTags.join(', ')}`);
          }
        }
      }

      if (!uploadProgress.includes('Dodano tagi:')) {
        setUploadProgress('Gotowe!');
      }

      setTimeout(() => {
        setUploadProgress('');
        setUploading(false);
        loadInvoices();
      }, 2500);
    } catch (err: any) {
      console.error('Upload error:', err);
      setUploadError(err.message || 'Wystąpił błąd podczas przesyłania pliku');
      setUploading(false);
      setTimeout(() => setUploadError(''), 5000);
    }
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

  const handleUploadSuccess = () => {
    setShowUpload(false);
    loadInvoices();
  };

  const toggleDepartment = (dept: string) => {
    setSelectedDepartments(prev =>
      prev.includes(dept)
        ? prev.filter(d => d !== dept)
        : [...prev, dept]
    );
  };

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev =>
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
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
        <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Faktury w Obiegu</h1>
        <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
          {filteredInvoices.length} z {invoices.length} {invoices.length === 1 ? 'faktury' : 'faktur'}
        </p>
      </div>

      <div
        className={`bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border-2 transition-colors mb-4 overflow-hidden ${
          dragActive
            ? 'border-brand-primary dark:border-brand-primary bg-brand-primary/5 dark:bg-brand-primary/10'
            : uploading
            ? 'border-brand-primary dark:border-brand-primary'
            : 'border-dashed border-slate-300 dark:border-slate-600/50 hover:border-brand-primary/30 dark:hover:border-brand-primary/30'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="p-6 text-center cursor-pointer" onClick={() => !uploading && fileInputRef.current?.click()}>
          <div className="flex flex-col items-center gap-2">
            <div className={`p-3 rounded-full transition-colors ${
              dragActive || uploading
                ? 'bg-brand-primary/20 dark:bg-brand-primary/30'
                : 'bg-light-surface-variant dark:bg-dark-surface-variant'
            }`}>
              {uploading ? (
                <Loader className="w-6 h-6 text-brand-primary animate-spin" />
              ) : (
                <FileText className={`w-6 h-6 transition-colors ${
                  dragActive
                    ? 'text-brand-primary'
                    : 'text-text-secondary-light dark:text-text-secondary-dark'
                }`} />
              )}
            </div>
            <div>
              {uploading ? (
                <>
                  <p className="text-sm font-semibold text-brand-primary mb-0.5">
                    {uploadProgress}
                  </p>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    Proszę czekać...
                  </p>
                </>
              ) : uploadError ? (
                <>
                  <p className="text-sm font-semibold text-status-error mb-0.5">
                    Błąd!
                  </p>
                  <p className="text-xs text-status-error">
                    {uploadError}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-0.5">
                    {dragActive ? 'Upuść plik tutaj' : 'Kliknij, aby wybrać plik'}
                  </p>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    lub przeciągnij i upuść • PDF, JPG, PNG (max 10MB)
                  </p>
                </>
              )}
            </div>
            {!uploading && !uploadError && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg transition-colors font-medium text-sm"
              >
                <Upload className="w-4 h-4" />
                Dodaj fakturę
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            disabled={uploading}
          />
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-3 mb-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">Status:</label>
            <button
              onClick={() => toggleStatus('draft')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedStatuses.includes('draft')
                  ? 'bg-brand-primary text-white'
                  : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
              }`}
            >
              Robocze
            </button>
            <button
              onClick={() => toggleStatus('waiting')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedStatuses.includes('waiting')
                  ? 'bg-brand-primary text-white'
                  : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
              }`}
            >
              Oczekujące
            </button>
            <button
              onClick={() => toggleStatus('pending')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedStatuses.includes('pending')
                  ? 'bg-brand-primary text-white'
                  : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
              }`}
            >
              W weryfikacji
            </button>
            <button
              onClick={() => toggleStatus('accepted')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedStatuses.includes('accepted')
                  ? 'bg-brand-primary text-white'
                  : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
              }`}
            >
              Zaakceptowana
            </button>
            <button
              onClick={() => toggleStatus('rejected')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedStatuses.includes('rejected')
                  ? 'bg-brand-primary text-white'
                  : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark hover:bg-brand-primary/10'
              }`}
            >
              Odrzucona
            </button>
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

      {showUpload && (
        <UploadInvoice
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
}
