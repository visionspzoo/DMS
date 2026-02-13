import { useState, useRef, useEffect } from 'react';
import { X, Upload, FileText, Loader, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  computeFileHash,
  checkDuplicateInDb,
  uploadInvoiceFile,
  validateFiles,
  type FileUploadEntry,
} from '../../lib/uploadUtils';

interface UploadInvoiceProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadInvoice({ onClose, onSuccess }: UploadInvoiceProps) {
  const { user } = useAuth();
  const [queue, setQueue] = useState<FileUploadEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const queueRef = useRef<FileUploadEntry[]>([]);
  const autoUploadTriggeredRef = useRef(false);

  const updateEntry = (index: number, update: Partial<FileUploadEntry>) => {
    setQueue(prev => {
      const next = prev.map((e, i) => i === index ? { ...e, ...update } : e);
      queueRef.current = next;
      return next;
    });
  };

  const addFiles = async (rawFiles: File[]) => {
    if (!user) return;
    const { valid, errors } = validateFiles(rawFiles);
    if (errors.length > 0) setError(errors.join('; '));

    const entries: FileUploadEntry[] = [];
    for (const file of valid) {
      const hash = await computeFileHash(file);
      const inQueue = queueRef.current.some(e => e.hash === hash);
      if (inQueue) {
        entries.push({ file, hash, status: 'duplicate', progress: 'Duplikat w tej partii' });
        continue;
      }
      const dbCheck = await checkDuplicateInDb(hash, user.id);
      if (dbCheck.isDuplicate) {
        entries.push({ file, hash, status: 'duplicate', progress: `Duplikat: ${dbCheck.label}` });
        continue;
      }
      entries.push({ file, hash, status: 'pending', progress: 'Oczekuje...' });
    }

    setQueue(prev => {
      const next = [...prev, ...entries];
      queueRef.current = next;
      return next;
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    autoUploadTriggeredRef.current = false;
    await addFiles(Array.from(e.target.files || []));
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setQueue(prev => {
      const next = prev.filter((_, i) => i !== index);
      queueRef.current = next;
      return next;
    });
  };

  const handleUpload = async () => {
    if (!user) return;
    const snapshot = [...queueRef.current];
    const pending = snapshot.map((e, i) => ({ e, i })).filter(({ e }) => e.status === 'pending');
    if (pending.length === 0) return;

    setUploading(true);
    setError('');

    for (const { e: entry, i: idx } of pending) {
      updateEntry(idx, { status: 'uploading', progress: 'Sprawdzanie...' });
      try {
        const dbCheck = await checkDuplicateInDb(entry.hash, user.id);
        if (dbCheck.isDuplicate) {
          updateEntry(idx, { status: 'duplicate', progress: `Duplikat: ${dbCheck.label}` });
          continue;
        }
        await uploadInvoiceFile(entry.file, entry.hash, user.id, (msg) => updateEntry(idx, { progress: msg }));
        updateEntry(idx, { status: 'success', progress: 'Gotowe!' });
      } catch (err: any) {
        updateEntry(idx, { status: 'error', progress: 'Błąd', error: err.message || 'Nieznany błąd' });
      }
    }

    setUploading(false);
    setDone(true);
  };

  useEffect(() => {
    const hasPending = queue.some(f => f.status === 'pending');
    if (hasPending && !uploading && !done && !autoUploadTriggeredRef.current) {
      autoUploadTriggeredRef.current = true;
      setTimeout(() => handleUpload(), 100);
    }
  }, [queue, uploading, done]);

  const successCount = queue.filter(f => f.status === 'success').length;
  const duplicateCount = queue.filter(f => f.status === 'duplicate').length;
  const errorCount = queue.filter(f => f.status === 'error').length;
  const pendingCount = queue.filter(f => f.status === 'pending').length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-xl font-semibold text-slate-900">Dodaj faktury</h2>
          <button
            onClick={() => { if (done) onSuccess(); else onClose(); }}
            disabled={uploading}
            className="p-2 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {queue.length === 0 ? (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-12 cursor-pointer hover:border-slate-400 transition group">
              <Upload className="w-12 h-12 text-slate-400 mb-4 group-hover:text-slate-500 transition-colors" />
              <p className="text-sm font-medium text-slate-900 mb-1">Kliknij, aby wybrać pliki</p>
              <p className="text-xs text-slate-600">PDF, JPG, PNG (maks. 10MB każdy)</p>
              <p className="text-xs text-slate-500 mt-1">Możesz wybrać wiele plików naraz</p>
              <input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                multiple
              />
            </label>
          ) : (
            <div className="space-y-4">
              {done && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <p className="text-sm font-semibold text-green-900">Zakończono</p>
                  </div>
                  <p className="text-xs text-green-700">
                    {successCount > 0 && `Przesłano: ${successCount}`}
                    {duplicateCount > 0 && ` | Duplikaty: ${duplicateCount}`}
                    {errorCount > 0 && ` | Błędy: ${errorCount}`}
                  </p>
                </div>
              )}

              <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                {queue.map((fp, index) => (
                  <div
                    key={`${fp.hash}-${index}`}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      fp.status === 'success' ? 'bg-green-50 border-green-200'
                        : fp.status === 'error' ? 'bg-red-50 border-red-200'
                        : fp.status === 'duplicate' ? 'bg-amber-50 border-amber-200'
                        : fp.status === 'uploading' ? 'bg-blue-50 border-blue-200'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex-shrink-0">
                      {fp.status === 'uploading' ? (
                        <Loader className="w-5 h-5 text-blue-600 animate-spin" />
                      ) : fp.status === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : fp.status === 'error' ? (
                        <X className="w-5 h-5 text-red-500" />
                      ) : fp.status === 'duplicate' ? (
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                      ) : (
                        <FileText className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{fp.file.name}</p>
                      <p className={`text-xs ${
                        fp.status === 'duplicate' ? 'text-amber-600'
                          : fp.status === 'error' ? 'text-red-600'
                          : 'text-slate-500'
                      }`}>
                        {(fp.file.size / 1024 / 1024).toFixed(2)} MB {fp.progress}
                      </p>
                      {fp.error && <p className="text-xs text-red-600 mt-0.5">{fp.error}</p>}
                    </div>
                    {!uploading && !done && fp.status !== 'uploading' && (
                      <button onClick={() => removeFile(index)} className="p-1 hover:bg-white/60 rounded transition flex-shrink-0">
                        <X className="w-4 h-4 text-slate-400" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-1">
                {!done && (
                  <label className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition font-medium text-center cursor-pointer text-sm">
                    Dodaj więcej
                    <input type="file" onChange={handleFileChange} accept=".pdf,.jpg,.jpeg,.png" className="hidden" multiple />
                  </label>
                )}
                {done ? (
                  <button onClick={onSuccess} className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition font-medium text-sm">
                    Zamknij
                  </button>
                ) : uploading ? (
                  <div className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-2">
                    <Loader className="w-4 h-4 animate-spin" />
                    Przetwarzanie ({successCount + duplicateCount + errorCount}/{queue.length})
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
