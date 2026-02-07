import { useState, useRef } from 'react';
import { X, Upload, FileText, Loader, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface UploadInvoiceProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface FileUploadProgress {
  file: File;
  hash: string;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'duplicate';
  progress: string;
  error?: string;
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function UploadInvoice({ onClose, onSuccess }: UploadInvoiceProps) {
  const { user } = useAuth();
  const [filesProgress, setFilesProgress] = useState<FileUploadProgress[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const filesRef = useRef<FileUploadProgress[]>([]);

  const hasFiles = filesProgress.length > 0;

  const updateFileProgress = (index: number, update: Partial<FileUploadProgress>) => {
    setFilesProgress(prev => {
      const next = prev.map((fp, i) => i === index ? { ...fp, ...update } : fp);
      filesRef.current = next;
      return next;
    });
  };

  const addFiles = async (newFiles: File[]) => {
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of newFiles) {
      if (file.size > 10 * 1024 * 1024) {
        errors.push(`${file.name} jest zbyt duży (maks. 10MB)`);
      } else {
        validFiles.push(file);
      }
    }

    if (errors.length > 0) {
      setError(errors.join(', '));
    }

    const newEntries: FileUploadProgress[] = [];
    for (const file of validFiles) {
      const hash = await computeFileHash(file);
      const existsInBatch = filesRef.current.some(fp => fp.hash === hash);
      newEntries.push({
        file,
        hash,
        status: existsInBatch ? 'duplicate' : 'pending',
        progress: existsInBatch ? 'Duplikat w tej partii' : 'Oczekuje...',
      });
    }

    setFilesProgress(prev => {
      const next = [...prev, ...newEntries];
      filesRef.current = next;
      return next;
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    setError('');
    await addFiles(selectedFiles);
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setFilesProgress(prev => {
      const next = prev.filter((_, i) => i !== index);
      filesRef.current = next;
      return next;
    });
  };

  const uploadSingleFile = async (fp: FileUploadProgress, index: number): Promise<void> => {
    if (fp.status === 'duplicate') return;

    updateFileProgress(index, { status: 'uploading', progress: 'Sprawdzanie duplikatów...' });

    try {
      const { data: existingInvoice } = await supabase
        .from('invoices')
        .select('id, invoice_number, supplier_name')
        .eq('file_hash', fp.hash)
        .eq('uploaded_by', user!.id)
        .maybeSingle();

      if (existingInvoice) {
        const label = existingInvoice.invoice_number || existingInvoice.supplier_name || existingInvoice.id;
        updateFileProgress(index, {
          status: 'duplicate',
          progress: `Duplikat faktury: ${label}`,
        });
        return;
      }

      updateFileProgress(index, { status: 'uploading', progress: 'Przesyłanie pliku...' });

      const file = fp.file;
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `invoices/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      updateFileProgress(index, { status: 'uploading', progress: 'Konwertowanie...' });

      const pdfBase64 = await fileToBase64(file);

      updateFileProgress(index, { status: 'uploading', progress: 'Zapisywanie...' });

      const { data: invoiceData, error: insertError } = await supabase
        .from('invoices')
        .insert({
          file_url: publicUrl,
          pdf_base64: file.type === 'application/pdf' ? pdfBase64 : null,
          uploaded_by: user!.id,
          file_hash: fp.hash,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      updateFileProgress(index, { status: 'uploading', progress: 'Google Drive...' });

      try {
        await fetch(
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
              department_id: invoiceData.department_id || null,
            }),
          }
        );
      } catch {
        // Google Drive is optional
      }

      updateFileProgress(index, { status: 'uploading', progress: 'OCR...' });

      try {
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

        if (ocrResponse.ok) {
          const ocrData = await ocrResponse.json();
          if (ocrData.suggestedTags?.length > 0) {
            for (const tag of ocrData.suggestedTags) {
              await supabase
                .from('invoice_tags')
                .insert({
                  invoice_id: invoiceData.id,
                  tag_id: tag.id,
                  created_by: user?.id,
                })
                .then(() => {});
            }
          }
          updateFileProgress(index, { status: 'success', progress: 'Gotowe!' });
        } else {
          updateFileProgress(index, { status: 'success', progress: 'Przesłano (OCR nieudany)' });
        }
      } catch {
        updateFileProgress(index, { status: 'success', progress: 'Przesłano (OCR nieudany)' });
      }
    } catch (err: any) {
      updateFileProgress(index, {
        status: 'error',
        progress: 'Błąd',
        error: err.message || 'Wystąpił błąd',
      });
    }
  };

  const handleUpload = async () => {
    if (!user) return;

    const snapshot = [...filesRef.current];
    const pendingFiles = snapshot
      .map((fp, i) => ({ fp, i }))
      .filter(({ fp }) => fp.status === 'pending');

    if (pendingFiles.length === 0) return;

    setUploading(true);
    setError('');

    for (const { fp, i } of pendingFiles) {
      await uploadSingleFile(fp, i);
    }

    setUploading(false);
    setDone(true);
  };

  const successCount = filesProgress.filter(f => f.status === 'success').length;
  const duplicateCount = filesProgress.filter(f => f.status === 'duplicate').length;
  const errorCount = filesProgress.filter(f => f.status === 'error').length;
  const pendingCount = filesProgress.filter(f => f.status === 'pending').length;

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

          {!hasFiles ? (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-12 cursor-pointer hover:border-slate-400 transition group">
              <Upload className="w-12 h-12 text-slate-400 mb-4 group-hover:text-slate-500 transition-colors" />
              <p className="text-sm font-medium text-slate-900 mb-1">
                Kliknij, aby wybrać pliki
              </p>
              <p className="text-xs text-slate-600">
                PDF, JPG, PNG (maks. 10MB każdy)
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Możesz wybrać wiele plików naraz
              </p>
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
                {filesProgress.map((fp, index) => (
                  <div
                    key={`${fp.hash}-${index}`}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      fp.status === 'success'
                        ? 'bg-green-50 border-green-200'
                        : fp.status === 'error'
                        ? 'bg-red-50 border-red-200'
                        : fp.status === 'duplicate'
                        ? 'bg-amber-50 border-amber-200'
                        : fp.status === 'uploading'
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex-shrink-0">
                      {fp.status === 'uploading' ? (
                        <Loader className="w-5 h-5 text-blue-600 animate-spin" />
                      ) : fp.status === 'success' ? (
                        <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : fp.status === 'error' ? (
                        <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                          <X className="w-3 h-3 text-white" />
                        </div>
                      ) : fp.status === 'duplicate' ? (
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                      ) : (
                        <FileText className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {fp.file.name}
                      </p>
                      <p className={`text-xs ${
                        fp.status === 'duplicate' ? 'text-amber-600' :
                        fp.status === 'error' ? 'text-red-600' : 'text-slate-500'
                      }`}>
                        {(fp.file.size / 1024 / 1024).toFixed(2)} MB
                        {' '}
                        {fp.progress}
                      </p>
                      {fp.error && (
                        <p className="text-xs text-red-600 mt-0.5">{fp.error}</p>
                      )}
                    </div>
                    {!uploading && !done && fp.status !== 'uploading' && (
                      <button
                        onClick={() => removeFile(index)}
                        className="p-1 hover:bg-white/60 rounded transition flex-shrink-0"
                      >
                        <X className="w-4 h-4 text-slate-400" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-1">
                {!uploading && !done && (
                  <label className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition font-medium text-center cursor-pointer text-sm">
                    Dodaj więcej
                    <input
                      type="file"
                      onChange={handleFileChange}
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      multiple
                    />
                  </label>
                )}
                {done ? (
                  <button
                    onClick={onSuccess}
                    className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition font-medium text-sm"
                  >
                    Zamknij
                  </button>
                ) : (
                  <button
                    onClick={handleUpload}
                    disabled={uploading || pendingCount === 0}
                    className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition font-medium disabled:opacity-50 text-sm"
                  >
                    {uploading
                      ? `Przesyłanie (${successCount + duplicateCount + errorCount}/${filesProgress.length})...`
                      : `Prześlij${pendingCount > 0 ? ` (${pendingCount})` : ''}`
                    }
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
