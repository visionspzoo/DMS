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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const tokenRow = await authenticateToken(supabase, req.headers.get('Authorization'));
    if (!tokenRow) {
      return json({ success: false, error: 'Unauthorized: invalid or missing API token' }, 401);
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    // POST /purchase-requests-api/proforma/{id}/mark-paid
    if (req.method === 'POST') {
      const markPaidMatch = pathname.match(/\/purchase-requests-api\/proforma\/([^/]+)\/mark-paid$/);

      if (!markPaidMatch) {
        return json({
          success: false,
          error: 'Not found. Use POST /purchase-requests-api/proforma/{id}/mark-paid',
        }, 404);
      }

      const requestId = decodeURIComponent(markPaidMatch[1]);

      const { data: request, error: fetchError } = await supabase
        .from('purchase_requests')
        .select('id, status, proforma_pdf_base64, proforma_filename')
        .eq('id', requestId)
        .maybeSingle();

      if (fetchError || !request) {
        return json({ success: false, error: `Purchase request not found: ${requestId}` }, 404);
      }

      if (!request.proforma_pdf_base64) {
        return json({
          success: false,
          error: 'This purchase request is not a proforma. Only proforma requests can be marked as paid via this endpoint.',
        }, 422);
      }

      if (request.status !== 'approved') {
        return json({
          success: false,
          error: `Purchase request cannot be marked as paid. Current status: "${request.status}". Only approved proforma requests can be marked as paid.`,
        }, 422);
      }

      const paidAt = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('purchase_requests')
        .update({ status: 'paid', paid_at: paidAt, updated_at: paidAt })
        .eq('id', requestId);

      if (updateError) {
        console.error('Error updating purchase request status:', updateError);
        return json({ success: false, error: 'Failed to update purchase request status' }, 500);
      }

      return json({
        success: true,
        data: {
          id: requestId,
          status: 'paid',
          paid_at: paidAt,
        },
      });
    }

    // GET /purchase-requests-api/proforma
    const proformaMatch = pathname.match(/\/purchase-requests-api\/proforma(\/([^/]+))?$/);

    if (!proformaMatch) {
      return json({
        success: false,
        error: 'Not found. Use GET /purchase-requests-api/proforma or GET /purchase-requests-api/proforma/{id}',
      }, 404);
    }

    const singleId = proformaMatch[2];

    // GET single proforma by id
    if (singleId) {
      const { data: request, error: fetchError } = await supabase
        .from('purchase_requests')
        .select(`
          id,
          description,
          delivery_location,
          priority,
          status,
          paid_at,
          created_at,
          updated_at,
          proforma_filename,
          proforma_pdf_base64,
          department:department_id (id, name, mpk_code),
          user:user_id (id, full_name, email)
        `)
        .eq('id', singleId)
        .not('proforma_pdf_base64', 'is', null)
        .maybeSingle();

      if (fetchError || !request) {
        return json({ success: false, error: `Proforma not found: ${singleId}` }, 404);
      }

      const includePdf = url.searchParams.get('include_pdf') === 'true';

      const entry: Record<string, unknown> = {
        id: request.id,
        description: request.description,
        delivery_location: request.delivery_location,
        priority: request.priority,
        status: request.status,
        paid_at: request.paid_at || null,
        created_at: request.created_at,
        updated_at: request.updated_at,
        proforma_filename: request.proforma_filename,
        department: request.department ? {
          id: (request.department as any).id,
          name: (request.department as any).name,
          mpk_code: (request.department as any).mpk_code || null,
        } : null,
        submitter: request.user ? {
          id: (request.user as any).id,
          full_name: (request.user as any).full_name,
          email: (request.user as any).email,
        } : null,
      };

      if (includePdf) {
        entry.proforma_pdf_base64 = request.proforma_pdf_base64;
      }

      return json({ success: true, data: entry });
    }

    // GET list of proformas
    const statusParam = url.searchParams.get('status');
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const fromDate = url.searchParams.get('from_date');
    const toDate = url.searchParams.get('to_date');
    const includePdf = url.searchParams.get('include_pdf') === 'true';

    const allowedStatuses = ['pending', 'approved', 'rejected', 'paid'];
    let statuses: string[];

    if (statusParam) {
      statuses = statusParam.split(',').map(s => s.trim()).filter(s => allowedStatuses.includes(s));
      if (statuses.length === 0) {
        return json({
          success: false,
          error: `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`,
        }, 400);
      }
    } else {
      statuses = ['approved'];
    }

    const limit = Math.min(parseInt(limitParam || '100', 10), 500);
    const offset = parseInt(offsetParam || '0', 10);

    let query = supabase
      .from('purchase_requests')
      .select(`
        id,
        user_id,
        description,
        delivery_location,
        priority,
        status,
        paid_at,
        created_at,
        updated_at,
        proforma_filename,
        proforma_pdf_base64,
        department:department_id (id, name, mpk_code)
      `)
      .not('proforma_pdf_base64', 'is', null)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (fromDate) {
      query = query.gte('created_at', fromDate);
    }
    if (toDate) {
      query = query.lte('created_at', toDate);
    }

    const { data: requests, error: listError } = await query;

    if (listError) {
      console.error('Error fetching proforma requests:', listError);
      return json({ success: false, error: 'Failed to fetch proforma purchase requests' }, 500);
    }

    const userIds = [...new Set((requests || []).map((r: any) => r.user_id).filter(Boolean))];
    let profilesMap: Record<string, { id: string; full_name: string; email: string }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);
      if (profiles) {
        for (const p of profiles) {
          profilesMap[p.id] = p;
        }
      }
    }

    const result = (requests || []).map((r: any) => {
      const profile = profilesMap[r.user_id] || null;
      const entry: Record<string, unknown> = {
        id: r.id,
        description: r.description,
        delivery_location: r.delivery_location,
        priority: r.priority,
        status: r.status,
        paid_at: r.paid_at || null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        proforma_filename: r.proforma_filename,
        department: r.department ? {
          id: r.department.id,
          name: r.department.name,
          mpk_code: r.department.mpk_code || null,
        } : null,
        submitter: profile ? {
          id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
        } : null,
      };

      if (includePdf) {
        entry.proforma_pdf_base64 = r.proforma_pdf_base64;
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
