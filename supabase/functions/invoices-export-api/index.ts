import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  if (req.method !== 'GET') {
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
        issue_date,
        due_date,
        currency,
        description,
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
        department:department_id (
          id,
          name,
          mpk_code
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

    const { data: invoices, error: invoiceError, count } = await query;

    if (invoiceError) {
      console.error('Error fetching invoices:', invoiceError);
      return json({ success: false, error: 'Failed to fetch invoices' }, 500);
    }

    const mpkCodes = [...new Set(
      (invoices || [])
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
      const mpkCode = inv.department?.mpk_code || null;
      const entry: Record<string, unknown> = {
        invoice_number: inv.invoice_number,
        supplier_name: inv.supplier_name,
        supplier_nip: inv.supplier_nip,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        mpk_code: mpkCode,
        department_name: inv.department?.name || null,
        currency: inv.currency,
        description: inv.description,
        mpk_description: mpkCode ? (costCentersMap[mpkCode] || null) : null,
        net_amount: inv.net_amount,
        tax_amount: inv.tax_amount,
        gross_amount: inv.gross_amount,
        pln_gross_amount: inv.pln_gross_amount,
        exchange_rate: inv.exchange_rate,
        status: inv.status,
        paid_at: inv.paid_at,
        updated_at: inv.updated_at,
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
