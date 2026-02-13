import { supabase } from './supabase';

export interface FileUploadEntry {
  file: File;
  hash: string;
  status: 'pending' | 'hashing' | 'uploading' | 'success' | 'error' | 'duplicate';
  progress: string;
  error?: string;
}

export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function checkDuplicateInDb(hash: string, _userId: string): Promise<{
  isDuplicate: boolean;
  label?: string;
}> {
  const { data } = await supabase
    .from('invoices')
    .select('id, invoice_number, supplier_name')
    .eq('file_hash', hash)
    .limit(1)
    .maybeSingle();

  if (data) {
    const label = data.invoice_number || data.supplier_name || data.id;
    return { isDuplicate: true, label };
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

  onProgress('Google Drive...');
  try {
    const { data: { session } } = await supabase.auth.getSession();
    console.log('[Upload] Session exists:', !!session);
    console.log('[Upload] Invoice department:', finalInvoiceData.department_id);

    if (session && finalInvoiceData.department_id) {
      const { data: folderMapping, error: folderError } = await supabase
        .from('user_drive_folder_mappings')
        .select('google_drive_folder_id, folder_name')
        .eq('user_id', userId)
        .eq('department_id', finalInvoiceData.department_id)
        .eq('is_active', true)
        .maybeSingle();

      console.log('[Upload] Folder mapping:', folderMapping);
      console.log('[Upload] Folder error:', folderError);

      if (folderMapping?.google_drive_folder_id) {
        console.log('[Upload] Uploading to folder:', folderMapping.folder_name, folderMapping.google_drive_folder_id);

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
              folderId: folderMapping.google_drive_folder_id,
              mimeType: file.type,
              originalMimeType: file.type,
              userId: userId,
              invoiceId: finalInvoiceData.id,
            }),
          }
        );

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error('[Upload] Failed to upload to Google Drive:', errorText);
        } else {
          const result = await uploadResponse.json();
          console.log('[Upload] ✓ Uploaded to Google Drive:', result);
        }
      } else {
        console.warn('[Upload] No folder mapping found for user:', userId, 'department:', finalInvoiceData.department_id);
      }
    } else {
      console.warn('[Upload] Missing session or department_id');
    }
  } catch (err) {
    console.error('[Upload] Google Drive upload error:', err);
  }

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

  onProgress('ML tagi...');
  try {
    const { data: { session } } = await supabase.auth.getSession();
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
