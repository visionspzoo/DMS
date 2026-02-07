import { useState } from 'react';
import { X, Upload, FileText, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface UploadInvoiceProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface FileUploadProgress {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: string;
  error?: string;
}

export function UploadInvoice({ onClose, onSuccess }: UploadInvoiceProps) {
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [filesProgress, setFilesProgress] = useState<FileUploadProgress[]>([]);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of selectedFiles) {
      if (file.size > 10 * 1024 * 1024) {
        errors.push(`${file.name} jest zbyt duży (maks. 10MB)`);
      } else {
        validFiles.push(file);
      }
    }

    if (errors.length > 0) {
      setError(errors.join(', '));
    } else {
      setError('');
    }

    setFiles(validFiles);
    setFilesProgress(validFiles.map(file => ({
      file,
      status: 'pending',
      progress: 'Oczekuje...',
    })));
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setFilesProgress(prev => prev.filter((_, i) => i !== index));
  };

  const uploadSingleFile = async (file: File, index: number) => {
    const updateProgress = (status: FileUploadProgress['status'], progress: string, error?: string) => {
      setFilesProgress(prev => prev.map((fp, i) =>
        i === index ? { ...fp, status, progress, error } : fp
      ));
    };

    try {
      updateProgress('uploading', 'Przesyłanie pliku...');

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

      updateProgress('uploading', 'Konwertowanie do base64...');

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

      updateProgress('uploading', 'Zapisywanie w bazie danych...');

      const { data: invoiceData, error: insertError } = await supabase
        .from('invoices')
        .insert({
          file_url: publicUrl,
          pdf_base64: file.type === 'application/pdf' ? pdfBase64 : null,
          uploaded_by: user!.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      updateProgress('uploading', 'Wysyłanie do Google Drive...');

      try {
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
              department_id: invoiceData.department_id || null,
            }),
          }
        );

        if (!driveResponse.ok) {
          console.log('Google Drive upload failed for:', file.name);
        }
      } catch (driveError: any) {
        console.log('Google Drive error for:', file.name);
      }

      updateProgress('uploading', 'Przetwarzanie OCR...');

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

          if (ocrData.suggestedTags && ocrData.suggestedTags.length > 0) {
            for (const tag of ocrData.suggestedTags) {
              try {
                await supabase
                  .from('invoice_tags')
                  .insert({
                    invoice_id: invoiceData.id,
                    tag_id: tag.id,
                    created_by: user?.id,
                  });
              } catch (tagErr) {
                console.error(`Error auto-applying tag ${tag.name}:`, tagErr);
              }
            }
            updateProgress('success', 'Gotowe! OCR przetworzony, tagi dodane.');
          } else {
            updateProgress('success', 'Gotowe! OCR przetworzony.');
          }
        } else {
          updateProgress('success', 'Przesłano! OCR nie powiódł się.');
        }
      } catch (ocrErr: any) {
        updateProgress('success', 'Przesłano! OCR nie powiódł się.');
      }
    } catch (err: any) {
      console.error('Upload error for', file.name, ':', err);
      updateProgress('error', 'Błąd', err.message || 'Wystąpił błąd');
    }
  };

  const handleUpload = async () => {
    if (files.length === 0 || !user) return;

    setUploading(true);
    setError('');

    for (let i = 0; i < files.length; i++) {
      await uploadSingleFile(files[i], i);
    }

    setTimeout(() => {
      setUploading(false);
      onSuccess();
    }, 2000);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-xl font-semibold text-slate-900">Dodaj fakturę</h2>
          <button
            onClick={onClose}
            disabled={uploading}
            className="p-2 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              <p className="font-medium">{error}</p>
            </div>
          )}

          {files.length === 0 ? (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-12 cursor-pointer hover:border-slate-400 transition">
              <Upload className="w-12 h-12 text-slate-400 mb-4" />
              <p className="text-sm font-medium text-slate-900 mb-1">
                Kliknij, aby wybrać pliki
              </p>
              <p className="text-xs text-slate-600">
                PDF, JPG, PNG (maks. 10MB każdy)
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Możesz wybrać wiele plików
              </p>
              <input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                disabled={uploading}
                multiple
              />
            </label>
          ) : (
            <div className="space-y-4">
              <div className="max-h-96 overflow-y-auto space-y-2">
                {filesProgress.map((fileProgress, index) => (
                  <div
                    key={index}
                    className={`flex items-center space-x-3 p-3 rounded-lg border ${
                      fileProgress.status === 'success'
                        ? 'bg-green-50 border-green-200'
                        : fileProgress.status === 'error'
                        ? 'bg-red-50 border-red-200'
                        : fileProgress.status === 'uploading'
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    {fileProgress.status === 'uploading' ? (
                      <Loader className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                    ) : fileProgress.status === 'success' ? (
                      <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : fileProgress.status === 'error' ? (
                      <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                        <X className="w-3 h-3 text-white" />
                      </div>
                    ) : (
                      <FileText className="w-5 h-5 text-slate-600 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {fileProgress.file.name}
                      </p>
                      <p className="text-xs text-slate-600">
                        {(fileProgress.file.size / 1024 / 1024).toFixed(2)} MB - {fileProgress.progress}
                      </p>
                      {fileProgress.error && (
                        <p className="text-xs text-red-600 mt-1">{fileProgress.error}</p>
                      )}
                    </div>
                    {!uploading && fileProgress.status === 'pending' && (
                      <button
                        onClick={() => removeFile(index)}
                        className="p-1 hover:bg-slate-200 rounded transition flex-shrink-0"
                      >
                        <X className="w-4 h-4 text-slate-600" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex space-x-3">
                {!uploading && (
                  <label className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition font-medium text-center cursor-pointer">
                    Dodaj więcej
                    <input
                      type="file"
                      onChange={(e) => {
                        const newFiles = Array.from(e.target.files || []);
                        const validFiles: File[] = [];

                        for (const file of newFiles) {
                          if (file.size <= 10 * 1024 * 1024) {
                            validFiles.push(file);
                          }
                        }

                        setFiles(prev => [...prev, ...validFiles]);
                        setFilesProgress(prev => [
                          ...prev,
                          ...validFiles.map(file => ({
                            file,
                            status: 'pending' as const,
                            progress: 'Oczekuje...',
                          }))
                        ]);
                        e.target.value = '';
                      }}
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      multiple
                    />
                  </label>
                )}
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition font-medium disabled:opacity-50"
                >
                  {uploading ? `Przesyłanie (${filesProgress.filter(f => f.status === 'success').length}/${files.length})...` : `Prześlij (${files.length})`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
