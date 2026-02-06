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
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

          const uploadResponse = await fetch(`${supabaseUrl}/functions/v1/upload-to-google-drive`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileBase64,
              fileName: title || file.name,
              mimeType: 'application/vnd.google-apps.document',
              originalMimeType: file.type,
              isContract: true,
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
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900">Dodaj nową umowę</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Tytuł umowy *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              placeholder="np. Umowa o współpracy z firmą XYZ"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Opis
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              placeholder="Dodatkowe informacje o umowie..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Plik umowy (PDF lub DOCX) *
            </label>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
              {file ? (
                <div>
                  <p className="text-slate-700 font-medium">{file.name}</p>
                  <p className="text-sm text-slate-500 mt-1">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  {file.name.toLowerCase().endsWith('.docx') && (
                    <p className="text-sm text-blue-600 mt-2">
                      ✓ Zostanie utworzony Google Doc z możliwością komentowania
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="mt-2 text-sm text-red-600 hover:text-red-700"
                  >
                    Usuń
                  </button>
                </div>
              ) : (
                <div>
                  <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-700 mb-2">Wybierz plik PDF lub DOCX</p>
                  <input
                    type="file"
                    accept=".pdf,.docx,.doc"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors"
                  >
                    Wybierz plik
                  </label>
                  <p className="text-sm text-slate-500 mt-2">
                    PDF - do podglądu | DOCX - z Google Docs do komentowania
                  </p>
                  <p className="text-sm text-slate-500">
                    Maksymalny rozmiar: 10MB
                  </p>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={!title || !file || uploading}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {uploading ? 'Przesyłanie...' : 'Dodaj umowę'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
