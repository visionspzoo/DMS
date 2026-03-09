import { supabase, getValidSession } from './supabase';

export interface FileUploadEntry {
  file: File;
  hash: string;
  status: 'pending' | 'hashing' | 'uploading' | 'success' | 'error' | 'duplicate' | 'duplicate_other_department';
  progress: string;
  error?: string;
  duplicateInfo?: {
    departmentName: string;
    uploaderName: string;
    invoiceNumber?: string;
  };
}

export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function checkDuplicateInDb(hash: string, userId: string): Promise<{
  isDuplicate: boolean;
  label?: string;
  isOtherDepartment?: boolean;
  departmentName?: string;
  uploaderName?: string;
  invoiceNumber?: string;
}> {
  const { data: currentUserProfile } = await supabase
    .from('profiles')
    .select('department_id, is_admin')
    .eq('id', userId)
    .maybeSingle();

  const { data } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      supplier_name,
      department_id,
      uploaded_by,
      uploader:profiles!uploaded_by(full_name),
      department:departments!department_id(name)
    `)
    .eq('file_hash', hash)
    .limit(1)
    .maybeSingle();

  if (data) {
    const label = data.invoice_number || data.supplier_name || data.id;
    const isOtherDepartment = currentUserProfile &&
      !currentUserProfile.is_admin &&
      data.department_id !== currentUserProfile.department_id;

    return {
      isDuplicate: true,
      label,
      isOtherDepartment,
      departmentName: data.department?.name || 'Nieznany dział',
      uploaderName: data.uploader?.full_name || 'Nieznany użytkownik',
      invoiceNumber: data.invoice_number,
    };
  }
  return { isDuplicate: false };
}

export function fileToBase64(file: File): Promise<string> {
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

export async function uploadInvoiceFile(
  file: File,
  hash: string,
  userId: string,
  onProgress: (msg: string) => void,
): Promise<{ invoiceId: string }> {
  onProgress('Przesyłanie pliku...');

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

  onProgress('Konwertowanie...');
  const pdfBase64 = await fileToBase64(file);

  onProgress('Zapisywanie...');
  const { data: invoiceData, error: insertError } = await supabase
    .from('invoices')
    .insert({
      file_url: publicUrl,
      pdf_base64: file.type === 'application/pdf' ? pdfBase64 : null,
      uploaded_by: userId,
      file_hash: hash,
      source: 'manual',
      status: 'draft',
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505' && insertError.message?.includes('file_hash')) {
      throw new Error('Ten plik został już przesłany wcześniej');
    }
    throw insertError;
  }

  // Pobierz fakturę ponownie, aby mieć department_id ustawione przez trigger
  const { data: refreshedInvoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceData.id)
    .single();

  const finalInvoiceData = refreshedInvoice || invoiceData;

  onProgress('OCR...');
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
          invoiceId: finalInvoiceData.id,
          mimeType: file.type,
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
              invoice_id: finalInvoiceData.id,
              tag_id: tag.id,
            })
            .then(() => {});
        }
      }
    }
  } catch {
    // OCR is optional
  }

  onProgress('Google Drive...');
  try {
    const { data: invoiceAfterOcr } = await supabase
      .from('invoices')
      .select('id, department_id, issue_date, invoice_number, supplier_name')
      .eq('id', finalInvoiceData.id)
      .maybeSingle();

    const invoiceForDrive = invoiceAfterOcr || finalInvoiceData;
    const deptId = invoiceForDrive.department_id;
    let targetFolderId: string | null = null;

    if (deptId) {
      const { data: deptInfo } = await supabase
        .from('departments')
        .select('google_drive_draft_folder_id')
        .eq('id', deptId)
        .maybeSingle();

      if (deptInfo?.google_drive_draft_folder_id) {
        targetFolderId = deptInfo.google_drive_draft_folder_id;
      }
    }

    if (!targetFolderId) {
      const { data: anyMapping } = await supabase
        .from('user_drive_folder_mappings')
        .select('google_drive_folder_id, google_drive_folder_url')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (anyMapping?.google_drive_folder_id) {
        targetFolderId = anyMapping.google_drive_folder_id;
      } else if (anyMapping?.google_drive_folder_url) {
        const urlMatch = anyMapping.google_drive_folder_url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (urlMatch) targetFolderId = urlMatch[1];
      }
    }

    if (targetFolderId) {
      const uploadResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-to-google-drive`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileBase64: pdfBase64,
            fileName: file.name,
            folderId: targetFolderId,
            mimeType: file.type,
            originalMimeType: file.type,
            userId: userId,
            invoiceId: invoiceForDrive.id,
            issueDate: invoiceForDrive.issue_date || null,
          }),
        }
      );

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('[Upload] Failed to upload to Google Drive:', errorText);
      } else {
        const result = await uploadResponse.json();
        console.log('[Upload] Uploaded to Google Drive:', result);
      }
    } else {
      console.warn('[Upload] No Google Drive folder configured, skipping Drive upload');
    }
  } catch (err) {
    console.error('[Upload] Google Drive upload error:', err);
  }

  onProgress('ML tagi...');
  try {
    const session = await getValidSession();
    if (session) {
      const mlResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ml-predict-tags`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            invoice_id: finalInvoiceData.id,
            force_refresh: true,
          }),
        }
      );

      if (mlResponse.ok) {
        const mlData = await mlResponse.json();
        const autoApply = (mlData.predictions || []).filter(
          (p: { confidence: number; tags: unknown }) =>
            p.confidence >= 0.7 && p.tags
        );

        for (const pred of autoApply) {
          await supabase
            .from('invoice_tags')
            .upsert(
              {
                invoice_id: finalInvoiceData.id,
                tag_id: pred.tag_id,
              },
              { onConflict: 'invoice_id,tag_id' }
            )
            .then(() => {});

          await supabase
            .from('ml_tag_predictions')
            .update({ applied: true })
            .eq('id', pred.id);
        }
      }
    }
  } catch {
    // ML tagging is optional
  }

  return { invoiceId: finalInvoiceData.id };
}

export function validateFiles(files: File[]): { valid: File[]; errors: string[] } {
  const valid: File[] = [];
  const errors: string[] = [];
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      errors.push(`${file.name}: za duży (maks. 10MB)`);
    } else if (!allowedTypes.includes(file.type)) {
      errors.push(`${file.name}: nieobsługiwany format`);
    } else {
      valid.push(file);
    }
  }

  return { valid, errors };
}
