import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { HardDrive, Play, Eye, CheckCircle, XCircle, AlertCircle, RefreshCw, FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface InvoicePreview {
  id: string;
  invoice_number: string;
  vendor: string;
  status: string;
  department: string;
  target_folder: string | null;
}

interface SyncItem {
  id: string;
  invoice_number: string;
  vendor: string;
  status: string;
  department: string;
  ok: boolean;
  error?: string;
  drive_file_id?: string;
}

interface BatchResult {
  success: boolean;
  processed?: number;
  skipped?: number;
  total?: number;
  has_more?: boolean;
  next_offset?: number;
  errors?: { id: string; error: string }[];
  items?: SyncItem[];
  invoices?: InvoicePreview[];
  error?: string;
}

interface SyncSummary {
  success: boolean;
  processed: number;
  skipped: number;
  errors: { id: string; error: string }[];
  items: SyncItem[];
  error?: string;
}

const BATCH_SIZE = 5;

export default function GoogleDriveSync() {
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<InvoicePreview[] | null>(null);
  const [result, setResult] = useState<SyncSummary | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showFailed, setShowFailed] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);

  async function callBatch(body: object): Promise<BatchResult> {
    const { data: { session: s } } = await supabase.auth.getSession();
    let token = s?.access_token;
    if (!token) throw new Error('Brak sesji');

    const expiresAt = s?.expires_at ? s.expires_at * 1000 : 0;
    if (expiresAt && Date.now() >= expiresAt - 60 * 1000) {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession();
      if (refreshed) token = refreshed.access_token;
    }

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bulk-upload-to-drive`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      let msg = `Blad synchronizacji (HTTP ${response.status})`;
      try {
        const d = await response.json();
        msg = d.error || msg;
      } catch {
        try {
          const text = await response.text();
          if (text) msg = text.substring(0, 200);
        } catch {}
      }
      throw new Error(msg);
    }
    return response.json();
  }

  async function runDryRun() {
    setLoading(true);
    setResult(null);
    setPreviewData(null);
    setProgress(null);
    try {
      const allInvoices: InvoicePreview[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const data = await callBatch({
          dry_run: true,
          only_missing: onlyMissing,
          batch_size: 50,
          offset,
        });
        allInvoices.push(...(data.invoices || []));
        hasMore = data.has_more ?? false;
        offset = data.next_offset ?? (offset + 50);
      }

      setPreviewData(allInvoices);
    } catch (err: any) {
      setResult({ success: false, processed: 0, skipped: 0, errors: [], items: [], error: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function runSync() {
    if (!confirm(`Czy na pewno chcesz wgrac ${previewData?.length ?? '?'} dokumentow do Google Drive?`)) return;

    setLoading(true);
    setPreviewData(null);
    setResult(null);
    setShowFailed(true);
    setShowSuccess(false);

    const total = previewData?.length ?? 0;
    setProgress({ done: 0, total });

    try {
      let processed = 0;
      let skipped = 0;
      const errors: { id: string; error: string }[] = [];
      const allItems: SyncItem[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const data = await callBatch({
          dry_run: false,
          only_missing: onlyMissing,
          batch_size: BATCH_SIZE,
          offset,
        });

        processed += data.processed ?? 0;
        skipped += data.skipped ?? 0;
        if (data.errors) errors.push(...data.errors);
        if (data.items) allItems.push(...data.items);

        hasMore = data.has_more ?? false;
        offset = data.next_offset ?? (offset + BATCH_SIZE);

        setProgress({ done: processed + skipped + errors.length, total });
      }

      setResult({ success: true, processed, skipped, errors, items: allItems });
    } catch (err: any) {
      setResult({ success: false, processed: 0, skipped: 0, errors: [], items: [], error: err.message });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  const statusColor: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    waiting: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    accepted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };

  const failedItems = result?.items.filter(i => !i.ok) ?? [];
  const successItems = result?.items.filter(i => i.ok) ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
            Synchronizacja dokumentow z Google Drive
          </h2>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Wgraj wszystkie dokumenty z systemu do odpowiednich folderow Google Drive przypisanych do dzialow.
          </p>

          <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 rounded-lg">
            <input
              type="checkbox"
              id="only_missing"
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
              className="w-4 h-4 text-brand-primary border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
            />
            <label htmlFor="only_missing" className="text-sm text-text-primary-light dark:text-text-primary-dark cursor-pointer">
              Tylko dokumenty bez Google Drive ID (brakujace)
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={runDryRun}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 border border-brand-primary text-brand-primary font-medium rounded-lg hover:bg-brand-primary/5 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && !previewData ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              Podglad (dry run)
            </button>

            {previewData && previewData.length > 0 && (
              <button
                onClick={runSync}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary/90 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Wgraj {previewData.length} dokumentow
              </button>
            )}
          </div>

          {progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-text-secondary-light dark:text-text-secondary-dark">
                <span>Przetwarzanie...</span>
                <span>{progress.done} / {progress.total}</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                <div
                  className="bg-brand-primary h-1.5 rounded-full transition-all duration-300"
                  style={{ width: progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%' }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {previewData && (
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
          <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center gap-2">
            <FileText className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Podglad: {previewData.length} dokumentow do wgrania
            </span>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-light-surface-variant dark:bg-dark-surface-variant sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Numer</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Dostawca</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Dzial</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Folder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                {previewData.map((inv) => (
                  <tr key={inv.id} className="hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors">
                    <td className="px-3 py-2 font-mono text-text-primary-light dark:text-text-primary-dark">{inv.invoice_number || '-'}</td>
                    <td className="px-3 py-2 text-text-primary-light dark:text-text-primary-dark max-w-32 truncate">{inv.vendor || '-'}</td>
                    <td className="px-3 py-2 text-text-secondary-light dark:text-text-secondary-dark">{inv.department || '-'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor[inv.status] || 'bg-slate-100 text-slate-600'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary-light dark:text-text-secondary-dark">
                      {inv.target_folder ? (
                        <span className={inv.target_folder.includes('brak folderu') ? 'text-amber-500 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>
                          {inv.target_folder}
                        </span>
                      ) : (
                        <span className="text-red-500">Brak folderu</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {result.success ? (
            <>
              <div className="rounded-lg border bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800/30 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <span className="text-sm font-semibold text-green-800 dark:text-green-300">Synchronizacja zakonczona</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                    <div className="text-lg font-bold text-green-700 dark:text-green-400">{result.processed}</div>
                    <div className="text-xs text-green-600 dark:text-green-500">Wgrano</div>
                  </div>
                  <div className="text-center p-2 bg-amber-100 dark:bg-amber-900/20 rounded-lg">
                    <div className="text-lg font-bold text-amber-700 dark:text-amber-400">{result.skipped}</div>
                    <div className="text-xs text-amber-600 dark:text-amber-500">Pominieto</div>
                  </div>
                  <div className="text-center p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
                    <div className="text-lg font-bold text-red-700 dark:text-red-400">{failedItems.length}</div>
                    <div className="text-xs text-red-600 dark:text-red-500">Bledy</div>
                  </div>
                </div>
              </div>

              {failedItems.length > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/30 overflow-hidden">
                  <button
                    onClick={() => setShowFailed(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-red-50 dark:bg-red-900/10 text-sm font-semibold text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4" />
                      Nie wgrano ({failedItems.length})
                    </div>
                    {showFailed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showFailed && (
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-red-50 dark:bg-red-900/10 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-[10px] font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">Numer</th>
                            <th className="px-3 py-2 text-left text-[10px] font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">Dostawca</th>
                            <th className="px-3 py-2 text-left text-[10px] font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">Dzial</th>
                            <th className="px-3 py-2 text-left text-[10px] font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">Blad</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-100 dark:divide-red-900/20">
                          {failedItems.map((item) => (
                            <tr key={item.id} className="bg-white dark:bg-dark-surface">
                              <td className="px-3 py-2 font-mono text-text-primary-light dark:text-text-primary-dark">{item.invoice_number || '-'}</td>
                              <td className="px-3 py-2 text-text-primary-light dark:text-text-primary-dark max-w-28 truncate">{item.vendor || '-'}</td>
                              <td className="px-3 py-2 text-text-secondary-light dark:text-text-secondary-dark">{item.department || '-'}</td>
                              <td className="px-3 py-2 text-red-600 dark:text-red-400 max-w-48 truncate" title={item.error}>{item.error}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {successItems.length > 0 && (
                <div className="rounded-lg border border-green-200 dark:border-green-800/30 overflow-hidden">
                  <button
                    onClick={() => setShowSuccess(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-green-50 dark:bg-green-900/10 text-sm font-semibold text-green-800 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/20 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" />
                      Wgrano pomyslnie ({successItems.length})
                    </div>
                    {showSuccess ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showSuccess && (
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-green-50 dark:bg-green-900/10 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-[10px] font-medium text-green-700 dark:text-green-400 uppercase tracking-wider">Numer</th>
                            <th className="px-3 py-2 text-left text-[10px] font-medium text-green-700 dark:text-green-400 uppercase tracking-wider">Dostawca</th>
                            <th className="px-3 py-2 text-left text-[10px] font-medium text-green-700 dark:text-green-400 uppercase tracking-wider">Dzial</th>
                            <th className="px-3 py-2 text-left text-[10px] font-medium text-green-700 dark:text-green-400 uppercase tracking-wider">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-green-100 dark:divide-green-900/20">
                          {successItems.map((item) => (
                            <tr key={item.id} className="bg-white dark:bg-dark-surface">
                              <td className="px-3 py-2 font-mono text-text-primary-light dark:text-text-primary-dark">{item.invoice_number || '-'}</td>
                              <td className="px-3 py-2 text-text-primary-light dark:text-text-primary-dark max-w-28 truncate">{item.vendor || '-'}</td>
                              <td className="px-3 py-2 text-text-secondary-light dark:text-text-secondary-dark">{item.department || '-'}</td>
                              <td className="px-3 py-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor[item.status] || 'bg-slate-100 text-slate-600'}`}>
                                  {item.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border p-4 bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">Blad synchronizacji</p>
                  <p className="text-sm text-red-700 dark:text-red-400">{result.error}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
