import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  if (req.method !== 'POST') {
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    const { invoice_number, invoice_id, paid_at } = body;

    if (!invoice_number && !invoice_id) {
      return json({ success: false, error: 'Required: invoice_number or invoice_id' }, 400);
    }

    let query = supabase
      .from('invoices')
      .select('id, invoice_number, status')
      .eq('status', 'accepted');

    if (invoice_id) {
      query = query.eq('id', invoice_id);
    } else {
      query = query.eq('invoice_number', invoice_number);
    }

    const { data: invoice, error: fetchError } = await query.maybeSingle();

    if (fetchError) {
      console.error('Error fetching invoice:', fetchError);
      return json({ success: false, error: 'Failed to fetch invoice' }, 500);
    }

    if (!invoice) {
      return json({
        success: false,
        error: invoice_id
          ? `Invoice with id "${invoice_id}" not found or not in "accepted" status`
          : `Invoice with number "${invoice_number}" not found or not in "accepted" status`,
      }, 404);
    }

    const paidAt = paid_at ? new Date(paid_at).toISOString() : new Date().toISOString();

    const { error: updateError } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: paidAt })
      .eq('id', invoice.id);

    if (updateError) {
      console.error('Error updating invoice:', updateError);
      return json({ success: false, error: 'Failed to update invoice status' }, 500);
    }

    await supabase.from('audit_logs').insert({
      invoice_id: invoice.id,
      user_id: tokenRow.user_id,
      action: 'status_changed',
      description: `Status zmieniony z "accepted" na "paid" przez API`,
    });

    return json({
      success: true,
      data: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        status: 'paid',
        paid_at: paidAt,
      },
    });
  } catch (error: any) {
    console.error('Unhandled error:', error);
    return json({ success: false, error: error.message || 'Internal server error' }, 500);
  }
});
