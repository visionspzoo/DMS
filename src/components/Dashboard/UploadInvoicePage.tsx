import { useState } from 'react';
import { Upload, FileText, Loader, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

export function UploadInvoice() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [progress, setProgress] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 10 * 1024 * 1024) {
        setError('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
        return;
      }
      setFile(selectedFile);
      setError('');
      setSuccess(false);
    }
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    setUploading(true);
    setError('');
    setSuccess(false);
    setProgress('Przesyłanie pliku...');

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

      setProgress('Zapisywanie do bazy danych...');

      const { error: insertError } = await supabase
        .from('invoices')
        .insert({
          file_url: publicUrl,
          file_name: file.name,
          uploaded_by: user.id,
        });

      if (insertError) throw insertError;

      setSuccess(true);
      setProgress('');
      setFile(null);

      // Reset form after 2 seconds
      setTimeout(() => {
        setSuccess(false);
      }, 3000);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Nie udało się przesłać pliku');
      setProgress('');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Dodaj Fakturę</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Prześlij nowy dokument do systemu
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Przesyłanie dokumentu</h2>
            </div>
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
              </div>
            )}

            {success && (
              <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                <p className="text-sm text-green-800 dark:text-green-300">Faktura została pomyślnie przesłana!</p>
              </div>
            )}

            {progress && (
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-2">
                <Loader className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
                <p className="text-sm text-blue-800 dark:text-blue-300">{progress}</p>
              </div>
            )}

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Wybierz plik faktury
                </label>
                <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center hover:border-blue-500 dark:hover:border-blue-400 transition">
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    id="file-upload"
                    disabled={uploading}
                  />
                  <label
                    htmlFor="file-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <div className="p-4 bg-slate-100 dark:bg-slate-700 rounded-full mb-4">
                      <FileText className="w-8 h-8 text-slate-600 dark:text-slate-400" />
                    </div>
                    {file ? (
                      <div>
                        <p className="text-slate-900 dark:text-white font-medium">{file.name}</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-slate-900 dark:text-white font-medium">
                          Kliknij, aby wybrać plik
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                          PDF, JPG, PNG (max 10MB)
                        </p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {uploading ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Przesyłanie...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    Prześlij fakturę
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
