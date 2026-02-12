import { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface UploadContractProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadContract({ onClose, onSuccess }: UploadContractProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const allowedTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword'
      ];

      if (!allowedTypes.includes(selectedFile.type)) {
        setError('Tylko pliki PDF i DOCX są dozwolone');
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) {
        setError('Plik jest zbyt duży (max 10MB)');
        return;
      }
      setFile(selectedFile);
      setError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !user) return;

    try {
      setUploading(true);
      setError('');

      const fileExt = file.name.split('.').pop()?.toLowerCase();
      const isDocx = fileExt === 'docx' || fileExt === 'doc';

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const fileBase64 = await base64Promise;

      let publicUrl = '';
      let googleDocId = null;

      if (isDocx) {
        try {
          if (!user) {
            throw new Error('Brak zalogowanego użytkownika');
          }

          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

          const uploadResponse = await fetch(`${supabaseUrl}/functions/v1/upload-to-google-drive`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileBase64,
              fileName: title || file.name,
              mimeType: 'application/vnd.google-apps.document',
              originalMimeType: file.type,
              isContract: true,
              userId: user.id,
            }),
          });

          if (uploadResponse.ok) {
            const uploadData = await uploadResponse.json();
            googleDocId = uploadData.fileId;
            publicUrl = uploadData.webViewLink || `https://docs.google.com/document/d/${uploadData.fileId}/edit`;
          } else {
            const errorText = await uploadResponse.text();
            throw new Error(`Nie udało się utworzyć Google Doc: ${errorText}`);
          }
        } catch (gdError: any) {
          console.error('Google Drive upload error:', gdError);
          throw new Error(gdError.message || 'Błąd podczas tworzenia Google Doc');
        }
      } else {
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `contracts/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, file, {
            contentType: 'application/pdf',
          });

        if (uploadError) throw uploadError;

        const { data: { publicUrl: pdfUrl } } = supabase.storage
          .from('documents')
          .getPublicUrl(filePath);

        publicUrl = pdfUrl;
      }

      const { error: insertError } = await supabase
        .from('contracts')
        .insert({
          title,
          description,
          file_url: publicUrl,
          pdf_base64: isDocx ? null : fileBase64,
          google_doc_id: googleDocId,
          uploaded_by: user.id,
          status: 'pending_manager',
        });

      if (insertError) throw insertError;

      onSuccess();
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Wystąpił błąd podczas przesyłania');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700/50">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700/50">
          <h2 className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">Dodaj nową umowę</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
              Tytuł umowy *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
              placeholder="np. Umowa o współpracy z firmą XYZ"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
              Opis
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
              placeholder="Dodatkowe informacje o umowie..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
              Plik umowy (PDF lub DOCX) *
            </label>
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-600/50 rounded-lg p-8 text-center bg-light-surface-variant dark:bg-dark-surface-variant">
              {file ? (
                <div>
                  <p className="text-text-primary-light dark:text-text-primary-dark font-medium">{file.name}</p>
                  <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-1">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  {file.name.toLowerCase().endsWith('.docx') && (
                    <p className="text-sm text-brand-primary mt-2">
                      ✓ Zostanie utworzony Google Doc z możliwością komentowania
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="mt-2 text-sm text-status-error hover:text-red-700"
                  >
                    Usuń
                  </button>
                </div>
              ) : (
                <div>
                  <Upload className="w-12 h-12 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-4" />
                  <p className="text-text-primary-light dark:text-text-primary-dark mb-2">Wybierz plik PDF lub DOCX</p>
                  <input
                    type="file"
                    accept=".pdf,.docx,.doc"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="inline-block px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg cursor-pointer transition-colors"
                  >
                    Wybierz plik
                  </label>
                  <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-2">
                    PDF - do podglądu | DOCX - z Google Docs do komentowania
                  </p>
                  <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                    Maksymalny rozmiar: 10MB
                  </p>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600/50 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={!title || !file || uploading}
              className="flex-1 px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {uploading ? 'Przesyłanie...' : 'Dodaj umowę'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
