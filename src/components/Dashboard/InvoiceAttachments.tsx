import { useState, useEffect, useRef } from 'react';
import { Paperclip, Upload, ExternalLink, Trash2, FileText, Image, File, X, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface Attachment {
  id: string;
  invoice_id: string;
  uploaded_by: string;
  file_name: string;
  google_drive_file_id: string;
  google_drive_web_view_link: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  uploader?: { full_name: string } | null;
}

interface InvoiceAttachmentsProps {
  invoiceId: string;
  invoiceNumber: string | null;
  departmentId: string | null;
}

function getFileIcon(mimeType: string | null) {
  if (!mimeType) return <File className="w-4 h-4" />;
  if (mimeType.startsWith('image/')) return <Image className="w-4 h-4" />;
  if (mimeType === 'application/pdf') return <FileText className="w-4 h-4" />;
  return <File className="w-4 h-4" />;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function InvoiceAttachments({ invoiceId, invoiceNumber, departmentId }: InvoiceAttachmentsProps) {
  const { user, profile } = useAuth();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAttachments();
  }, [invoiceId]);

  const loadAttachments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('invoice_attachments')
        .select(`
          *,
          uploader:uploaded_by(full_name)
        `)
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAttachments(data || []);
    } catch (err) {
      console.error('Error loading attachments:', err);
    } finally {
      setLoading(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    setUploadError(null);

    const errors: string[] = [];

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setUploadError('Not authenticated');
      setUploading(false);
      return;
    }

    for (const file of fileArray) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const fileBase64 = btoa(binary);

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-invoice-attachment`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileBase64,
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              fileSize: file.size,
              invoiceId,
              invoiceNumber: invoiceNumber || '',
              departmentId: departmentId || null,
            }),
          }
        );

        const result = await response.json();
        if (!response.ok) {
          errors.push(`${file.name}: ${result.error || 'Upload failed'}`);
        }
      } catch (err: any) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      setUploadError(errors.join('\n'));
    }

    await loadAttachments();
    setUploading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDelete = async (attachment: Attachment) => {
    if (!confirm(`Usunąć załącznik "${attachment.file_name}"?`)) return;

    try {
      const { error } = await supabase
        .from('invoice_attachments')
        .delete()
        .eq('id', attachment.id);

      if (error) throw error;
      setAttachments(prev => prev.filter(a => a.id !== attachment.id));
    } catch (err) {
      console.error('Error deleting attachment:', err);
      alert('Nie udało się usunąć załącznika');
    }
  };

  const canDelete = (attachment: Attachment) =>
    profile?.is_admin || attachment.uploaded_by === user?.id;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Paperclip className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
        <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
          Załączniki
        </h3>
        {!loading && (
          <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            ({attachments.length})
          </span>
        )}
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all
          ${dragOver
            ? 'border-brand-primary bg-brand-primary/5'
            : 'border-slate-300 dark:border-slate-600/50 hover:border-brand-primary hover:bg-brand-primary/5'
          }
          ${uploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
          disabled={uploading}
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">
            <div className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
            Przesyłanie...
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">
            <Upload className="w-4 h-4" />
            <span>Kliknij lub przeciągnij pliki tutaj</span>
          </div>
        )}
      </div>

      {uploadError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-700 dark:text-red-400 whitespace-pre-line">{uploadError}</p>
          </div>
          <button onClick={() => setUploadError(null)} className="flex-shrink-0">
            <X className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <div className="w-5 h-5 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : attachments.length > 0 ? (
        <div className="space-y-1.5">
          {attachments.map(attachment => (
            <div
              key={attachment.id}
              className="flex items-center gap-2.5 p-2.5 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50 group hover:border-brand-primary/30 transition-colors"
            >
              <span className="text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0">
                {getFileIcon(attachment.mime_type)}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                  {attachment.file_name}
                </p>
                <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  {formatFileSize(attachment.file_size)}
                  {attachment.uploader?.full_name && (
                    <span> · {attachment.uploader.full_name}</span>
                  )}
                  <span> · {new Date(attachment.created_at).toLocaleDateString('pl-PL')}</span>
                </p>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <a
                  href={attachment.google_drive_web_view_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="p-1.5 rounded-md hover:bg-light-surface dark:hover:bg-dark-surface transition-colors text-brand-primary"
                  title="Otwórz w Google Drive"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {canDelete(attachment) && (
                  <button
                    onClick={() => handleDelete(attachment)}
                    className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-text-secondary-light dark:text-text-secondary-dark hover:text-red-500"
                    title="Usuń załącznik"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark text-center py-2">
          Brak załączników
        </p>
      )}
    </div>
  );
}
