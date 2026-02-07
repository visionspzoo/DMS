import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function jsonResponse(data: unknown, status = 200) {
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

async function authenticateToken(supabase: any, authHeader: string) {
  const token = authHeader.replace('Bearer ', '');

  if (!token.startsWith('aurs_')) {
    return null;
  }

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

async function getInvoices(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, department_id')
    .eq('id', userId)
    .maybeSingle();

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id, invoice_number, supplier_name, supplier_nip,
      net_amount, gross_amount, vat_amount, currency,
      pln_net_amount, pln_gross_amount, exchange_rate,
      issue_date, due_date, status, description,
      department:department_id(id, name),
      uploader:uploaded_by(full_name, email, role),
      created_at, updated_at
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching invoices:', error);
    return [];
  }

  return data || [];
}

async function getDepartments(supabase: any) {
  const { data } = await supabase
    .from('departments')
    .select('id, name, monthly_limit, parent_department_id');
  return data || [];
}

async function getMLData(supabase: any) {
  const { data: tagLearning } = await supabase
    .from('tag_learning')
    .select(`
      vendor_name, supplier_nip, description_keywords,
      tag:tag_id(id, name, color),
      department:department_id(id, name),
      amount_bucket, frequency
    `)
    .order('frequency', { ascending: false })
    .limit(200);

  const { data: tags } = await supabase
    .from('tags')
    .select('id, name, color');

  const { data: predictions } = await supabase
    .from('ml_tag_predictions')
    .select(`
      invoice_id,
      tag:tag_id(id, name),
      confidence, source, reasoning,
      applied, dismissed, created_at
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  const { data: invoiceTags } = await supabase
    .from('invoice_tags')
    .select(`
      invoice_id,
      tag:tag_id(id, name, color)
    `)
    .limit(500);

  return {
    tagLearning: tagLearning || [],
    tags: tags || [],
    predictions: predictions || [],
    invoiceTags: invoiceTags || [],
  };
}

async function getContracts(supabase: any) {
  const { data } = await supabase
    .from('contracts')
    .select(`
      id, title, status, contract_type,
      start_date, end_date, value, currency,
      department:department_id(id, name),
      uploader:uploaded_by(full_name, email),
      created_at
    `)
    .order('created_at', { ascending: false });

  return data || [];
}

async function getKSEFInvoices(supabase: any) {
  const { data } = await supabase
    .from('ksef_invoices')
    .select(`
      id, ksef_reference_number, seller_name, seller_nip,
      buyer_name, buyer_nip, net_amount, gross_amount,
      tax_amount, currency, issue_date, status,
      department:department_id(id, name),
      created_at
    `)
    .order('created_at', { ascending: false });

  return data || [];
}

async function getProfiles(supabase: any) {
  const { data } = await supabase
    .from('profiles')
    .select(`
      id, full_name, email, role, is_admin,
      department:department_id(id, name)
    `);

  return data || [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Server configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header. Use: Bearer aurs_...' }, 401);
    }

    const tokenRow = await authenticateToken(supabase, authHeader);
    if (!tokenRow) {
      return jsonResponse({ error: 'Invalid or expired API token' }, 401);
    }

    const userId = tokenRow.user_id;

    const url = new URL(req.url);
    const path = url.pathname.replace('/alice-api', '').replace(/^\/+/, '') || '';

    if (req.method === 'GET' && (path === '' || path === 'context')) {
      const [invoices, departments, mlData, contracts, ksefInvoices, profiles] = await Promise.all([
        getInvoices(supabase, userId),
        getDepartments(supabase),
        getMLData(supabase),
        getContracts(supabase),
        getKSEFInvoices(supabase),
        getProfiles(supabase),
      ]);

      const invoiceStats = {
        total: invoices.length,
        byStatus: invoices.reduce((acc: Record<string, number>, inv: any) => {
          acc[inv.status] = (acc[inv.status] || 0) + 1;
          return acc;
        }, {}),
        totalGrossPLN: invoices.reduce((sum: number, inv: any) =>
          sum + (inv.pln_gross_amount || inv.gross_amount || 0), 0),
      };

      const mlStats = {
        totalLearningEntries: mlData.tagLearning.length,
        totalTags: mlData.tags.length,
        totalPredictions: mlData.predictions.length,
        appliedPredictions: mlData.predictions.filter((p: any) => p.applied).length,
        dismissedPredictions: mlData.predictions.filter((p: any) => p.dismissed).length,
        avgConfidence: mlData.predictions.length > 0
          ? Number((mlData.predictions.reduce((s: number, p: any) => s + (p.confidence || 0), 0) / mlData.predictions.length).toFixed(3))
          : 0,
      };

      return jsonResponse({
        success: true,
        data: {
          invoices,
          invoiceStats,
          departments,
          ml: {
            stats: mlStats,
            tagLearning: mlData.tagLearning,
            tags: mlData.tags,
            recentPredictions: mlData.predictions,
            invoiceTags: mlData.invoiceTags,
          },
          contracts,
          ksefInvoices,
          profiles,
        },
        meta: {
          generatedAt: new Date().toISOString(),
          userId,
        },
      });
    }

    if (req.method === 'GET' && path === 'invoices') {
      const invoices = await getInvoices(supabase, userId);
      return jsonResponse({ success: true, data: invoices });
    }

    if (req.method === 'GET' && path === 'departments') {
      const departments = await getDepartments(supabase);
      return jsonResponse({ success: true, data: departments });
    }

    if (req.method === 'GET' && path === 'ml') {
      const mlData = await getMLData(supabase);
      return jsonResponse({ success: true, data: mlData });
    }

    if (req.method === 'GET' && path === 'contracts') {
      const contracts = await getContracts(supabase);
      return jsonResponse({ success: true, data: contracts });
    }

    if (req.method === 'GET' && path === 'ksef') {
      const ksefInvoices = await getKSEFInvoices(supabase);
      return jsonResponse({ success: true, data: ksefInvoices });
    }

    if (req.method === 'GET' && path === 'profiles') {
      const profiles = await getProfiles(supabase);
      return jsonResponse({ success: true, data: profiles });
    }

    return jsonResponse({
      error: 'Unknown endpoint',
      availableEndpoints: [
        'GET /alice-api/context  - Full system context (all data)',
        'GET /alice-api/invoices  - Invoices only',
        'GET /alice-api/departments - Departments',
        'GET /alice-api/ml - ML tag learning + predictions',
        'GET /alice-api/contracts - Contracts',
        'GET /alice-api/ksef - KSeF invoices',
        'GET /alice-api/profiles - User profiles',
      ],
    }, 404);
  } catch (error: any) {
    console.error('Alice API error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
