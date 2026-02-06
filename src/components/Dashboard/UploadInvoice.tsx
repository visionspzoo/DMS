import { useState } from 'react';
import { X, Upload, FileText, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface UploadInvoiceProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface SuggestedTag {
  id: string;
  name: string;
  color: string;
  confidence: number;
}

export function UploadInvoice({ onClose, onSuccess }: UploadInvoiceProps) {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [ocrDetails, setOcrDetails] = useState<{status?: string, error?: string}>({});
  const [suggestedTags, setSuggestedTags] = useState<SuggestedTag[]>([]);
  const [currentInvoiceId, setCurrentInvoiceId] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 10 * 1024 * 1024) {
        setError('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
        return;
      }
      setFile(selectedFile);
      setError('');
    }
  };

  const applySuggestedTag = async (tag: SuggestedTag) => {
    if (!currentInvoiceId) return;

    try {
      const { error } = await supabase
        .from('invoice_tags')
        .insert({
          invoice_id: currentInvoiceId,
          tag_id: tag.id,
          created_by: user?.id,
        });

      if (error) throw error;

      setSuggestedTags(prev => prev.filter(t => t.id !== tag.id));
      setProgress(`Tag "${tag.name}" został dodany!`);
    } catch (err: any) {
      console.error('Error applying tag:', err);
      setError(`Nie udało się dodać tagu: ${err.message}`);
    }
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    setUploading(true);
    setError('');
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

      setProgress('Konwertowanie do base64...');

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

      setProgress('Zapisywanie w bazie danych...');

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

      setProgress('Wysyłanie do Google Drive...');

      let driveSuccess = false;
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
          const errorData = await driveResponse.json();
          console.error('Google Drive upload failed:', errorData);
          console.log('Faktura została zapisana, ale nie w Google Drive');
        } else {
          const driveData = await driveResponse.json();
          console.log('Google Drive upload successful:', driveData);
          driveSuccess = true;
        }
      } catch (driveError: any) {
        console.error('Google Drive error:', driveError);
        console.log('Faktura została zapisana, ale nie w Google Drive');
      }

      setProgress('Przetwarzanie OCR...');

      let ocrSuccess = false;
      let ocrError = '';

      console.log('=== STARTING OCR PROCESS ===');
      console.log('Invoice ID:', invoiceData.id);
      console.log('File URL:', publicUrl);
      console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);

      try {
        const ocrUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-invoice-ocr`;
        console.log('OCR Endpoint:', ocrUrl);

        const ocrResponse = await fetch(ocrUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileUrl: publicUrl,
            invoiceId: invoiceData.id,
          }),
        });

        console.log('OCR Response Status:', ocrResponse.status);
        console.log('OCR Response Headers:', Object.fromEntries(ocrResponse.headers.entries()));

        if (!ocrResponse.ok) {
          const errorText = await ocrResponse.text();
          console.error('OCR Error Response (raw):', errorText);

          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }

          console.error('OCR Error Data:', errorData);
          ocrError = errorData.error || errorData.details || 'Processing failed';
          setOcrDetails({ status: `${ocrResponse.status}`, error: ocrError });
          setError(`OCR nie powiódł się: ${ocrError}`);
        } else {
          const ocrData = await ocrResponse.json();
          console.log('OCR SUCCESS! Response:', ocrData);
          console.log('Extracted data:', ocrData.data);
          console.log('Used API:', ocrData.usedApi);
          console.log('Suggested tags:', ocrData.suggestedTags);
          ocrSuccess = true;

          if (ocrData.suggestedTags && ocrData.suggestedTags.length > 0) {
            console.log('Auto-applying suggested tags...');
            setCurrentInvoiceId(invoiceData.id);

            const autoAppliedTags: string[] = [];
            for (const tag of ocrData.suggestedTags) {
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
                  console.log(`✓ Auto-applied tag: ${tag.name} (confidence: ${tag.confidence})`);
                } else {
                  console.error(`Failed to auto-apply tag ${tag.name}:`, tagError);
                }
              } catch (tagErr) {
                console.error(`Error auto-applying tag ${tag.name}:`, tagErr);
              }
            }

            if (autoAppliedTags.length > 0) {
              setSuggestedTags(ocrData.suggestedTags);
              setProgress(`Gotowe! Automatycznie dodano tagi: ${autoAppliedTags.join(', ')}`);
            }
          }
        }
      } catch (ocrErr: any) {
        console.error('OCR Exception:', ocrErr);
        console.error('Error stack:', ocrErr.stack);
        ocrError = ocrErr.message;
        setOcrDetails({ status: 'exception', error: ocrError });
        setError(`OCR nie powiódł się: ${ocrError}`);
      }

      console.log('=== OCR PROCESS COMPLETED ===');
      console.log('Success:', ocrSuccess);
      console.log('Error:', ocrError);

      if (ocrSuccess) {
        if (!progress.includes('Automatycznie dodano tagi')) {
          setProgress('Gotowe! Faktura została przetworzona.');
        }
      } else {
        setProgress('Faktura została przesłana. OCR nie powiódł się - wypełnij dane ręcznie.');
      }

      setTimeout(() => {
        setUploading(false);
        onSuccess();
      }, 3000);
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Wystąpił błąd podczas przesyłania pliku');
      setUploading(false);
    }
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
              {ocrDetails.status && (
                <div className="mt-2 text-sm">
                  <p><strong>Status OCR:</strong> {ocrDetails.status}</p>
                  {ocrDetails.error && <p><strong>Szczegóły:</strong> {ocrDetails.error}</p>}
                  <p className="mt-2 text-xs">
                    <strong>Co sprawdzić:</strong>
                    <br />1. Czy klucz MISTRAL_API_KEY jest dodany w Supabase (Project Settings → Edge Functions → Secrets)
                    <br />2. Otwórz konsolę (F12) i sprawdź szczegółowe logi
                    <br />3. Sprawdź logi Edge Function w Supabase Dashboard
                  </p>
                </div>
              )}
            </div>
          )}

          {!file ? (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-12 cursor-pointer hover:border-slate-400 transition">
              <Upload className="w-12 h-12 text-slate-400 mb-4" />
              <p className="text-sm font-medium text-slate-900 mb-1">
                Kliknij, aby wybrać plik
              </p>
              <p className="text-xs text-slate-600">
                PDF, JPG, PNG (maks. 10MB)
              </p>
              <input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                disabled={uploading}
              />
            </label>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center space-x-3 p-4 bg-slate-50 rounded-lg">
                <FileText className="w-8 h-8 text-slate-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-slate-600">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>

              {uploading && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center space-x-3">
                    <Loader className="w-5 h-5 text-blue-600 animate-spin" />
                    <p className="text-sm text-blue-900 font-medium">{progress}</p>
                  </div>
                </div>
              )}

              {suggestedTags.length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-green-900 mb-3">
                    Sugerowane tagi na podstawie dostawcy:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedTags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => applySuggestedTag(tag)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-opacity hover:opacity-80"
                        style={{
                          backgroundColor: `${tag.color}20`,
                          color: tag.color,
                          border: `1px solid ${tag.color}40`,
                        }}
                        title={`Użyto ${tag.confidence} razy dla tego dostawcy`}
                      >
                        <span>{tag.name}</span>
                        <span className="text-xs opacity-60">({tag.confidence}×)</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-green-700 mt-2">
                    Kliknij tag, aby dodać go do faktury
                  </p>
                </div>
              )}

              <div className="flex space-x-3">
                <button
                  onClick={() => setFile(null)}
                  disabled={uploading}
                  className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition font-medium disabled:opacity-50"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition font-medium disabled:opacity-50"
                >
                  {uploading ? 'Przesyłanie...' : 'Prześlij'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
