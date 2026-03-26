import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function authenticateToken(supabase: any, authHeader: string | null) {
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  if (!token.startsWith('aurs_')) return null;

  const tokenHash = await sha256(token);
  const { data: tokenRow, error } = await supabase
    .from('api_tokens')
    .select('id, user_id, is_active, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !tokenRow) return null;
  if (!tokenRow.is_active) return null;
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) return null;

  await supabase
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenRow.id);

  return tokenRow;
}

function getMimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase().split('?')[0];
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

async function fetchFileAsBase64(fileUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return { base64: btoa(binary), mimeType: getMimeTypeFromUrl(fileUrl) };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const tokenRow = await authenticateToken(supabase, req.headers.get('Authorization'));
    if (!tokenRow) {
      return json({ success: false, error: 'Unauthorized: invalid or missing API token' }, 401);
    }

    const url = new URL(req.url);

    if (req.method === 'POST') {
      const pathname = url.pathname;
      const markPaidMatch = pathname.match(/\/invoices-export-api\/invoices\/([^/]+)\/mark-paid$/);

      if (!markPaidMatch) {
        return json({ success: false, error: 'Not found. Use POST /invoices-export-api/invoices/{invoice_number}/mark-paid' }, 404);
      }

      const invoiceNumber = decodeURIComponent(markPaidMatch[1]);

      const { data: invoice, error: fetchError } = await supabase
        .from('invoices')
        .select('id, invoice_number, status')
        .eq('invoice_number', invoiceNumber)
        .maybeSingle();

      if (fetchError || !invoice) {
        return json({ success: false, error: `Invoice not found: ${invoiceNumber}` }, 404);
      }

      if (invoice.status !== 'accepted') {
        return json({
          success: false,
          error: `Invoice cannot be marked as paid. Current status: "${invoice.status}". Only invoices with status "accepted" can be marked as paid.`,
        }, 422);
      }

      let body: any = {};
      try { body = await req.json(); } catch { /* no body */ }

      const { payment_method } = body;
      const validPaymentMethods = ['Gotówka', 'Przelew', 'Karta'];
      if (payment_method && !validPaymentMethods.includes(payment_method)) {
        return json({ success: false, error: `Invalid payment_method. Allowed values: ${validPaymentMethods.join(', ')}` }, 400);
      }

      const paidAt = new Date().toISOString();
      const updatePayload: Record<string, unknown> = { status: 'paid', paid_at: paidAt, updated_at: paidAt };
      if (payment_method) updatePayload.payment_method = payment_method;

      const { error: updateError } = await supabase
        .from('invoices')
        .update(updatePayload)
        .eq('id', invoice.id);

      if (updateError) {
        return json({ success: false, error: 'Failed to update invoice status' }, 500);
      }

      const auditDesc = payment_method
        ? `Status zmieniony z "accepted" na "paid" przez zewnętrzny system (API) (metoda płatności: ${payment_method})`
        : `Status zmieniony z "accepted" na "paid" przez zewnętrzny system (API)`;

      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: 'status_changed',
        performed_by: tokenRow.user_id,
        description: auditDesc,
      });

      return json({ success: true, data: { invoice_number: invoiceNumber, status: 'paid', paid_at: paidAt, payment_method: payment_method || null } });
    }

    const statusParam = url.searchParams.get('status');
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const fromDate = url.searchParams.get('from_date');
    const toDate = url.searchParams.get('to_date');
    const includePdf = url.searchParams.get('include_pdf') === 'true';

    const allowedStatuses = ['paid', 'accepted'];
    let statuses: string[];

    if (statusParam) {
      statuses = statusParam.split(',').map(s => s.trim()).filter(s => allowedStatuses.includes(s));
      if (statuses.length === 0) {
        return json({ success: false, error: `Invalid status. Allowed values: ${allowedStatuses.join(', ')}` }, 400);
      }
    } else {
      statuses = allowedStatuses;
    }

    const limit = Math.min(parseInt(limitParam || '100', 10), 500);
    const offset = parseInt(offsetParam || '0', 10);

    let q = supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        supplier_name,
        supplier_nip,
        buyer_name,
        buyer_nip,
        issue_date,
        due_date,
        currency,
        description,
        internal_comment,
        bez_mpk,
        net_amount,
        tax_amount,
        gross_amount,
        pln_gross_amount,
        exchange_rate,
        status,
        paid_at,
        payment_method,
        created_at,
        updated_at,
        pz_number,
        file_url,
        uploaded_by,
        profiles!invoices_uploaded_by_fkey (
          full_name,
          email
        ),
        departments!invoices_department_id_fkey (
          id,
          name,
          mpk_code
        ),
        cost_centers!invoices_cost_center_id_fkey (
          id,
          code,
          description
        ),
        invoice_attachments!invoice_attachments_invoice_id_fkey (
          id,
          file_name,
          google_drive_web_view_link,
          mime_type,
          file_size,
          created_at
        )
      `)
      .in('status', statuses)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (fromDate) q = q.gte('issue_date', fromDate);
    if (toDate) q = q.lte('issue_date', toDate);

    const { data: invoices, error: invoiceError } = await q;

    if (invoiceError) {
      console.error('Invoice fetch error:', JSON.stringify(invoiceError));
      return json({ success: false, error: `Failed to fetch invoices: ${invoiceError.message}` }, 500);
    }

    const result = await Promise.all((invoices || []).map(async (inv: any) => {
      const owner = inv['profiles!invoices_uploaded_by_fkey'];
      const department = inv['departments!invoices_department_id_fkey'];
      const costCenter = inv['cost_centers!invoices_cost_center_id_fkey'];
      const attachmentRows = inv['invoice_attachments!invoice_attachments_invoice_id_fkey'] || [];

      const entry: Record<string, unknown> = {
        invoice_number: inv.invoice_number,
        owner_name: owner?.full_name || null,
        supplier_name: inv.supplier_name,
        supplier_nip: inv.supplier_nip,
        buyer_name: inv.buyer_name || null,
        buyer_nip: inv.buyer_nip || null,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        mpk_code: department?.mpk_code || null,
        department_name: department?.name || null,
        currency: inv.currency,
        description: inv.description || null,
        internal_comment: inv.internal_comment || null,
        cost_center_code: costCenter?.code || null,
        cost_center_name: costCenter ? `${costCenter.code} - ${costCenter.description}` : null,
        bez_mpk: inv.bez_mpk || false,
        net_amount: inv.net_amount,
        tax_amount: inv.tax_amount,
        gross_amount: inv.gross_amount,
        pln_gross_amount: inv.pln_gross_amount,
        exchange_rate: inv.exchange_rate,
        status: inv.status,
        paid_at: inv.paid_at,
        payment_method: inv.payment_method || null,
        updated_at: inv.updated_at,
        pz_number: inv.pz_number || null,
        attachments: attachmentRows.map((a: any) => ({
          id: a.id,
          file_name: a.file_name,
          url: a.google_drive_web_view_link || null,
          mime_type: a.mime_type,
          file_size: a.file_size,
          created_at: a.created_at,
        })),
      };

      if (includePdf) {
        const { data: pdfRow } = await supabase
          .from('invoices')
          .select('pdf_base64, file_url')
          .eq('id', inv.id)
          .maybeSingle();

        if (pdfRow?.pdf_base64) {
          entry.pdf_base64 = pdfRow.pdf_base64;
          entry.file_mime_type = 'application/pdf';
        } else if (pdfRow?.file_url) {
          const fetched = await fetchFileAsBase64(pdfRow.file_url);
          entry.pdf_base64 = fetched?.base64 || null;
          entry.file_mime_type = fetched?.mimeType || null;
        } else {
          entry.pdf_base64 = null;
          entry.file_mime_type = null;
        }
      }

      return entry;
    }));

    return json({
      success: true,
      data: result,
      meta: { total: result.length, limit, offset, statuses_included: statuses },
    });

  } catch (error: any) {
    console.error('Unhandled error:', error);
    return json({ success: false, error: error.message || 'Internal server error' }, 500);
  }
});
