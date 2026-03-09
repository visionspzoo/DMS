import { useState, useEffect } from 'react';
import { supabase, getValidSession } from '../../lib/supabase';
import { Upload, FileText, AlertCircle, CheckCircle, Building2 } from 'lucide-react';

interface DyrektorUploadInvoiceProps {
  userId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

interface Department {
  id: string;
  name: string;
  google_drive_draft_folder_id: string | null;
  director_id: string | null;
  isGuest?: boolean;
}

export default function DyrektorUploadInvoice({ userId, onSuccess, onCancel }: DyrektorUploadInvoiceProps) {
  const [file, setFile] = useState<File | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDepartments() {
      const [deptRes, memberRes] = await Promise.all([
        supabase
          .from('departments')
          .select('id, name, google_drive_draft_folder_id, director_id')
          .order('name'),
        supabase
          .from('department_members')
          .select('department_id')
          .eq('user_id', userId),
      ]);

      const allDepts: Department[] = deptRes.data || [];
      const memberDeptIds = new Set((memberRes.data || []).map((r: { department_id: string }) => r.department_id));

      const visibleDepts: Department[] = allDepts
        .filter(d => d.director_id === userId || memberDeptIds.has(d.id))
        .map(d => ({
          ...d,
          isGuest: d.director_id !== userId && memberDeptIds.has(d.id),
        }));

      setDepartments(visibleDepts);
    }
    loadDepartments();
  }, [userId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!file) {
      setError('Please select a file');
      return;
    }

    if (!departmentId) {
      setError('Please select a department');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `invoices/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      const reader = new FileReader();
      const pdfBase64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.readAsDataURL(file);
      });

      const selectedDeptObj = departments.find(d => d.id === departmentId);
      const isGuestDept = selectedDeptObj?.isGuest ?? false;

      const { data: invoiceData, error: insertError } = await supabase
        .from('invoices')
        .insert({
          file_url: publicUrl,
          pdf_base64: file.type === 'application/pdf' ? pdfBase64 : null,
          uploaded_by: userId,
          status: isGuestDept ? 'draft' : 'accepted',
          department_id: departmentId,
          currency: 'PLN',
          source: 'manual',
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const session = await getValidSession();
      if (session) {
        const selectedDept = departments.find(d => d.id === departmentId);
        if (selectedDept?.google_drive_draft_folder_id) {
          const driveResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-to-google-drive`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                fileBase64: pdfBase64,
                fileName: file.name,
                folderId: selectedDept.google_drive_draft_folder_id,
                mimeType: file.type,
                originalMimeType: file.type,
                userId: userId,
                invoiceId: invoiceData.id,
              }),
            }
          );

          if (!driveResponse.ok) {
            console.error('Google Drive upload failed:', await driveResponse.text());
          }
        }
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload invoice');
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'application/pdf') {
        setError('Only PDF files are allowed');
        setFile(null);
        return;
      }
      setFile(selectedFile);
      setError(null);
    }
  }

  return (
    <div className="bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-slate-600" />
              <h2 className="text-lg font-semibold text-slate-900">Upload Invoice</h2>
            </div>
            <p className="text-sm text-slate-600 mt-1">
              Upload an invoice that will be automatically accepted
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-900">Error</h3>
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              </div>
            )}

            {(() => {
              const selectedDeptObj = departments.find(d => d.id === departmentId);
              if (selectedDeptObj?.isGuest) {
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-amber-900">Dział obiegu (gościnny)</h3>
                      <p className="text-amber-700 text-sm">
                        Faktura zostanie skierowana do normalnego obiegu akceptacji. Koszty tego działu nie wliczają się do Twoich limitów miesięcznych.
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-blue-900">Przesyłanie przez Dyrektora</h3>
                    <p className="text-blue-700 text-sm">
                      Faktury przesłane przez dyrektora do własnego działu są automatycznie akceptowane i pomijają obieg.
                    </p>
                  </div>
                </div>
              );
            })()}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Dział *
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                >
                  <option value="">Wybierz dział</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}{dept.isGuest ? ' (obieg)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Specify which department this invoice belongs to
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Invoice File (PDF) *
              </label>
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  id="file-upload"
                  required
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer flex flex-col items-center"
                >
                  {file ? (
                    <>
                      <FileText className="w-12 h-12 text-green-600 mb-3" />
                      <p className="text-sm font-medium text-slate-900">{file.name}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <p className="text-xs text-blue-600 mt-2">Click to change file</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-12 h-12 text-slate-400 mb-3" />
                      <p className="text-sm font-medium text-slate-900">
                        Click to upload or drag and drop
                      </p>
                      <p className="text-xs text-slate-500 mt-1">PDF files only</p>
                    </>
                  )}
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-4">
              <button
                type="submit"
                disabled={uploading}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
              >
                {uploading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    Upload Invoice
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={uploading}
                className="px-6 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
