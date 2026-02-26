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

      const paidAt = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('invoices')
        .update({ status: 'paid', paid_at: paidAt, updated_at: paidAt })
        .eq('id', invoice.id);

      if (updateError) {
        console.error('Error updating invoice status:', updateError);
        return json({ success: false, error: 'Failed to update invoice status' }, 500);
      }

      await supabase.from('audit_logs').insert({
        invoice_id: invoice.id,
        action: 'status_changed',
        performed_by: tokenRow.user_id,
        description: `Status zmieniony z "accepted" na "paid" przez zewnętrzny system (API)`,
      });

      return json({
        success: true,
        data: {
          invoice_number: invoiceNumber,
          status: 'paid',
          paid_at: paidAt,
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

    let query = supabase
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
        created_at,
        updated_at,
        pdf_base64,
        pz_number,
        uploaded_by,
        department:department_id (
          id,
          name,
          mpk_code
        ),
        invoice_attachments (
          id,
          file_name,
          google_drive_web_view_link,
          mime_type,
          file_size,
          storage_path,
          created_at
        )
      `)
      .in('status', statuses)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (fromDate) {
      query = query.gte('issue_date', fromDate);
    }
    if (toDate) {
      query = query.lte('issue_date', toDate);
    }

    const { data: invoices, error: invoiceError } = await query;

    if (invoiceError) {
      console.error('Error fetching invoices:', invoiceError);
      return json({ success: false, error: 'Failed to fetch invoices' }, 500);
    }

    const uploaderIds = [...new Set(
      (invoices || []).map((inv: any) => inv.uploaded_by).filter(Boolean)
    )];

    let bezMpkUserIds = new Set<string>();
    if (uploaderIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, mpk_override_bez_mpk')
        .in('id', uploaderIds)
        .eq('mpk_override_bez_mpk', true);

      if (profiles) {
        for (const p of profiles) {
          bezMpkUserIds.add(p.id);
        }
      }
    }

    const mpkCodes = [...new Set(
      (invoices || [])
        .filter((inv: any) => !bezMpkUserIds.has(inv.uploaded_by))
        .map((inv: any) => inv.department?.mpk_code)
        .filter(Boolean)
    )];

    let costCentersMap: Record<string, string> = {};
    if (mpkCodes.length > 0) {
      const { data: costCenters } = await supabase
        .from('cost_centers')
        .select('code, description')
        .in('code', mpkCodes);

      if (costCenters) {
        for (const cc of costCenters) {
          costCentersMap[cc.code] = cc.description;
        }
      }
    }

    const result = (invoices || []).map((inv: any) => {
      const isBezMpk = inv.bez_mpk === true || bezMpkUserIds.has(inv.uploaded_by);
      const mpkCode = isBezMpk ? 'BEZ MPK' : (inv.department?.mpk_code || null);
      const departmentName = isBezMpk ? 'BEZ MPK' : (inv.department?.name || null);
      const mpkDescription = isBezMpk ? (inv.description || null) : (mpkCode ? (costCentersMap[mpkCode] || null) : null);

      const attachments = (inv.invoice_attachments || []).map((a: any) => ({
        id: a.id,
        file_name: a.file_name,
        url: a.google_drive_web_view_link || null,
        mime_type: a.mime_type,
        file_size: a.file_size,
        created_at: a.created_at,
      }));

      const entry: Record<string, unknown> = {
        invoice_number: inv.invoice_number,
        supplier_name: inv.supplier_name,
        supplier_nip: inv.supplier_nip,
        buyer_name: inv.buyer_name || null,
        buyer_nip: inv.buyer_nip || null,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        mpk_code: mpkCode,
        department_name: departmentName,
        currency: inv.currency,
        description: inv.description || null,
        internal_comment: inv.internal_comment || null,
        mpk_description: mpkDescription,
        bez_mpk: inv.bez_mpk || false,
        net_amount: inv.net_amount,
        tax_amount: inv.tax_amount,
        gross_amount: inv.gross_amount,
        pln_gross_amount: inv.pln_gross_amount,
        exchange_rate: inv.exchange_rate,
        status: inv.status,
        paid_at: inv.paid_at,
        updated_at: inv.updated_at,
        pz_number: inv.pz_number || null,
        attachments,
      };

      if (includePdf) {
        entry.pdf_base64 = inv.pdf_base64;
      }

      return entry;
    });

    return json({
      success: true,
      data: result,
      meta: {
        total: result.length,
        limit,
        offset,
        statuses_included: statuses,
      },
    });
  } catch (error: any) {
    console.error('Unhandled error:', error);
    return json({ success: false, error: error.message || 'Internal server error' }, 500);
  }
});
