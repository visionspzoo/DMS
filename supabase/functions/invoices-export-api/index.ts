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
    if (!response.ok) {
      console.error(`Failed to fetch file: ${fileUrl}, status: ${response.status}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    const mimeType = getMimeTypeFromUrl(fileUrl);
    return { base64, mimeType };
  } catch (err) {
    console.error(`Error fetching file as base64: ${err}`);
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
      try { body = await req.json(); } catch { /* no body is fine */ }

      const { payment_method } = body;
      const validPaymentMethods = ['Gotówka', 'Przelew', 'Karta'];
      if (payment_method && !validPaymentMethods.includes(payment_method)) {
        return json({ success: false, error: `Invalid payment_method. Allowed values: ${validPaymentMethods.join(', ')}` }, 400);
      }

      const paidAt = new Date().toISOString();
      const updatePayload: Record<string, unknown> = { status: 'paid', paid_at: paidAt, updated_at: paidAt };
      if (payment_method) {
        updatePayload.payment_method = payment_method;
      }

      const { error: updateError } = await supabase
        .from('invoices')
        .update(updatePayload)
        .eq('id', invoice.id);

      if (updateError) {
        console.error('Error updating invoice status:', updateError);
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

      return json({
        success: true,
        data: {
          invoice_number: invoiceNumber,
          status: 'paid',
          paid_at: paidAt,
          payment_method: payment_method || null,
        },
      });
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

    let invoiceQuery = `
      SELECT
        i.id,
        i.invoice_number,
        i.supplier_name,
        i.supplier_nip,
        i.buyer_name,
        i.buyer_nip,
        i.issue_date,
        i.due_date,
        i.currency,
        i.description,
        i.internal_comment,
        i.bez_mpk,
        i.net_amount,
        i.tax_amount,
        i.gross_amount,
        i.pln_gross_amount,
        i.exchange_rate,
        i.status,
        i.paid_at,
        i.payment_method,
        i.created_at,
        i.updated_at,
        i.pz_number,
        i.uploaded_by,
        i.file_url,
        ${includePdf ? 'i.pdf_base64,' : ''}
        p.full_name AS owner_full_name,
        p.email AS owner_email,
        d.id AS dept_id,
        d.name AS dept_name,
        d.mpk_code AS dept_mpk_code,
        cc.id AS cc_id,
        cc.code AS cc_code,
        cc.description AS cc_description,
        (
          SELECT json_agg(json_build_object(
            'id', ia.id,
            'file_name', ia.file_name,
            'url', ia.google_drive_web_view_link,
            'mime_type', ia.mime_type,
            'file_size', ia.file_size,
            'created_at', ia.created_at
          ))
          FROM invoice_attachments ia
          WHERE ia.invoice_id = i.id
        ) AS attachments
      FROM invoices i
      LEFT JOIN profiles p ON p.id = i.uploaded_by
      LEFT JOIN departments d ON d.id = i.department_id
      LEFT JOIN cost_centers cc ON cc.id = i.cost_center_id
      WHERE i.status = ANY($1::text[])
    `;

    const queryParams: any[] = [statuses];
    let paramIdx = 2;

    if (fromDate) {
      invoiceQuery += ` AND i.issue_date >= $${paramIdx}`;
      queryParams.push(fromDate);
      paramIdx++;
    }
    if (toDate) {
      invoiceQuery += ` AND i.issue_date <= $${paramIdx}`;
      queryParams.push(toDate);
      paramIdx++;
    }

    invoiceQuery += ` ORDER BY i.updated_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    queryParams.push(limit, offset);

    const { data: invoices, error: invoiceError } = await supabase.rpc('exec_sql_invoices_export', {
      query_text: invoiceQuery,
      query_params: queryParams,
    });

    if (invoiceError) {
      console.error('RPC error, falling back to direct query:', invoiceError);

      const { data: fallbackInvoices, error: fallbackError } = await supabase
        .from('invoices')
        .select(`
          id, invoice_number, supplier_name, supplier_nip, buyer_name, buyer_nip,
          issue_date, due_date, currency, description, internal_comment, bez_mpk,
          net_amount, tax_amount, gross_amount, pln_gross_amount, exchange_rate,
          status, paid_at, payment_method, created_at, updated_at, pz_number,
          uploaded_by, file_url, pdf_base64,
          owner:profiles!invoices_uploaded_by_fkey (id, full_name, email),
          department:departments!invoices_department_id_fkey (id, name, mpk_code),
          cost_center:cost_centers!invoices_cost_center_id_fkey (id, code, description),
          invoice_attachments!invoice_attachments_invoice_id_fkey (id, file_name, google_drive_web_view_link, mime_type, file_size, created_at)
        `)
        .in('status', statuses)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (fallbackError) {
        console.error('Fallback query error:', JSON.stringify(fallbackError));
        return json({ success: false, error: `Failed to fetch invoices: ${fallbackError.message}` }, 500);
      }

      const result = await Promise.all((fallbackInvoices || []).map(async (inv: any) => {
        const entry: Record<string, unknown> = {
          invoice_number: inv.invoice_number,
          owner_name: inv.owner?.full_name || null,
          supplier_name: inv.supplier_name,
          supplier_nip: inv.supplier_nip,
          buyer_name: inv.buyer_name || null,
          buyer_nip: inv.buyer_nip || null,
          issue_date: inv.issue_date,
          due_date: inv.due_date,
          mpk_code: inv.department?.mpk_code || null,
          department_name: inv.department?.name || null,
          currency: inv.currency,
          description: inv.description || null,
          internal_comment: inv.internal_comment || null,
          mpk_description: null,
          cost_center_code: inv.cost_center?.code || null,
          cost_center_name: inv.cost_center ? `${inv.cost_center.code} - ${inv.cost_center.description}` : null,
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
          attachments: (inv.invoice_attachments || []).map((a: any) => ({
            id: a.id,
            file_name: a.file_name,
            url: a.google_drive_web_view_link || null,
            mime_type: a.mime_type,
            file_size: a.file_size,
            created_at: a.created_at,
          })),
        };

        if (includePdf) {
          if (inv.pdf_base64) {
            entry.pdf_base64 = inv.pdf_base64;
            entry.file_mime_type = 'application/pdf';
          } else if (inv.file_url) {
            const fetched = await fetchFileAsBase64(inv.file_url);
            if (fetched) {
              entry.pdf_base64 = fetched.base64;
              entry.file_mime_type = fetched.mimeType;
            } else {
              entry.pdf_base64 = null;
              entry.file_mime_type = null;
            }
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
    }

    return json({
      success: true,
      data: invoices,
      meta: { total: invoices?.length || 0, limit, offset, statuses_included: statuses },
    });

  } catch (error: any) {
    console.error('Unhandled error:', error);
    return json({ success: false, error: error.message || 'Internal server error' }, 500);
  }
});
