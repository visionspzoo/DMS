import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { HardDrive, Play, Eye, CheckCircle, XCircle, AlertCircle, RefreshCw, FileText } from 'lucide-react';

interface InvoicePreview {
  id: string;
  invoice_number: string;
  vendor: string;
  status: string;
  department: string;
  target_folder: string | null;
}

interface SyncResult {
  success: boolean;
  processed?: number;
  skipped?: number;
  total?: number;
  errors?: { id: string; error: string }[];
  dry_run?: boolean;
  invoices?: InvoicePreview[];
  error?: string;
}

export default function GoogleDriveSync() {
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<InvoicePreview[] | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(true);

  async function runDryRun() {
    setLoading(true);
    setResult(null);
    setPreviewData(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bulk-upload-to-drive`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ dry_run: true, only_missing: onlyMissing }),
        }
      );

      const data: SyncResult = await response.json();
      if (!response.ok) throw new Error(data.error || 'Błąd podglądu');
      setPreviewData(data.invoices || []);
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function runSync() {
    if (!confirm(`Czy na pewno chcesz wgrać ${previewData?.length ?? '?'} dokumentów do Google Drive? Operacja może chwilę potrwać.`)) return;

    setLoading(true);
    setPreviewData(null);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bulk-upload-to-drive`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ dry_run: false, only_missing: onlyMissing }),
        }
      );

      const data: SyncResult = await response.json();
      if (!response.ok) throw new Error(data.error || 'Błąd synchronizacji');
      setResult(data);
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }

  const statusColor: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    waiting: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    accepted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };

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
            Wgraj wszystkie dokumenty z systemu do odpowiednich folderów Google Drive przypisanych do działów.
            Dokumenty zostaną wgrane przez Google Cloud API (Service Account) lub przez podpięte konto Google.
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
              Tylko dokumenty bez Google Drive ID (brakujące)
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
        </div>
      </div>

      {previewData && (
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
          <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                Podglad: {previewData.length} dokumentow do wgrania
              </span>
            </div>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-light-surface-variant dark:bg-dark-surface-variant sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Numer</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Dostawca</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Dział</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">Folder Drive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                {previewData.map((inv) => (
                  <tr key={inv.id} className="hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors">
                    <td className="px-3 py-2 font-mono text-text-primary-light dark:text-text-primary-dark">
                      {inv.invoice_number || '-'}
                    </td>
                    <td className="px-3 py-2 text-text-primary-light dark:text-text-primary-dark max-w-32 truncate">
                      {inv.vendor || '-'}
                    </td>
                    <td className="px-3 py-2 text-text-secondary-light dark:text-text-secondary-dark">
                      {inv.department || '-'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor[inv.status] || 'bg-slate-100 text-slate-600'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-text-secondary-light dark:text-text-secondary-dark">
                      {inv.target_folder ? (
                        <span className="text-green-600 dark:text-green-400">{inv.target_folder.slice(0, 20)}...</span>
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
        <div className={`rounded-lg border p-4 ${
          result.success
            ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800/30'
            : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30'
        }`}>
          {result.success ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                <span className="text-sm font-semibold text-green-800 dark:text-green-300">
                  Synchronizacja zakonczona
                </span>
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
                  <div className="text-lg font-bold text-red-700 dark:text-red-400">{result.errors?.length ?? 0}</div>
                  <div className="text-xs text-red-600 dark:text-red-500">Bledy</div>
                </div>
              </div>

              {result.errors && result.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400">Bledy:</p>
                  {result.errors.map((err) => (
                    <div key={err.id} className="text-xs text-red-600 dark:text-red-400 flex gap-2">
                      <XCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span><span className="font-mono">{err.id.slice(0, 8)}</span>: {err.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800 dark:text-red-300">Blad synchronizacji</p>
                <p className="text-sm text-red-700 dark:text-red-400">{result.error}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
